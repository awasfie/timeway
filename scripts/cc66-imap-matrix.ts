/**
 * CC-66 invite matrix (WC-TW-8d): create -> reschedule -> cancel through the public
 * booking API, then read every invite back over IMAP and check it is one calendar entry
 * updated in place, sent with aligned SPF/DKIM/DMARC.
 *
 * No repo dependencies on purpose: it runs from a bare checkout with `npx tsx`, against
 * prod, and must not pull the monorepo's build graph in. IMAP and MIME are handled with
 * the minimum needed to read Gmail/Outlook.com messages.
 *
 * Env (values never printed):
 *   CC66_MAILBOXES   comma list of provider ids to run: gmail,outlook (default gmail)
 *   CC66_GMAIL_USER / CC66_GMAIL_APP_PASSWORD
 *   CC66_OUTLOOK_USER / CC66_OUTLOOK_APP_PASSWORD (Outlook.com refuses LOGIN: "Basic authentication is disabled")
 *   CC66_OUTLOOK_GRAPH_REFRESH_TOKEN + CC66_MS_CLIENT_ID  Outlook via Microsoft Graph Mail.Read (preferred; IMAP is
 *                    "authenticated but not connected" for this mailbox)
 *   CC66_OUTLOOK_REFRESH_TOKEN + CC66_MS_CLIENT_ID / CC66_MS_CLIENT_SECRET
 *                    when set, outlook signs in with AUTHENTICATE XOAUTH2 instead of LOGIN
 *                    (token scope https://outlook.office.com/IMAP.AccessAsUser.All offline_access)
 *   CC66_BASE_URL    default https://timeway.co
 *   CC66_EN_HOST / CC66_AR_HOST  "username/eventSlug" of the staff test event types
 *   CC66_EXPECT_ORGANIZER  sending address the ICS ORGANIZER must equal (default bookings@notify.timeway.co)
 *   CC66_EXPECT_DOMAIN     d= / header.from domain (default notify.timeway.co)
 *   CC66_OUT_DIR           default docs/proofs/cc-66
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { connect, type TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";

type Locale = "en" | "ar";
type Step = "create" | "reschedule" | "cancel";

const BASE = process.env.CC66_BASE_URL ?? "https://timeway.co";
const EXPECT_ORGANIZER = (process.env.CC66_EXPECT_ORGANIZER ?? "bookings@notify.timeway.co").toLowerCase();
const EXPECT_DOMAIN = (process.env.CC66_EXPECT_DOMAIN ?? "notify.timeway.co").toLowerCase();
const OUT_DIR = process.env.CC66_OUT_DIR ?? "docs/proofs/cc-66";
const POLL_MS = 30_000;
const POLL_MAX_MS = 10 * 60_000;
// Cloudflare in front of timeway.co rejects default script user agents (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 cc66-imap-matrix";

const HOSTS: Record<Locale, string> = {
  en: process.env.CC66_EN_HOST ?? "wcdx10cen64761/30min",
  ar: process.env.CC66_AR_HOST ?? "wcdx10car64865/30min",
};

const PROVIDERS = {
  gmail: { imapHost: "imap.gmail.com", userEnv: "CC66_GMAIL_USER", passEnv: "CC66_GMAIL_APP_PASSWORD" },
  outlook: {
    imapHost: "outlook.office365.com",
    userEnv: "CC66_OUTLOOK_USER",
    passEnv: "CC66_OUTLOOK_APP_PASSWORD",
    oauthEnv: "CC66_OUTLOOK_REFRESH_TOKEN",
  },
} as const;
type Provider = keyof typeof PROVIDERS;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- booking API (same calls the public Booker makes) ----------

async function getEventTypeId(username: string, slug: string): Promise<{ id: number; length: number }> {
  const input = { "0": { json: { username, eventSlug: slug, isTeamEvent: false, org: null } } };
  const res = await fetch(
    `${BASE}/api/trpc/public/event?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`,
    { headers: { "user-agent": UA } }
  );
  const body = (await res.json()) as Array<{ result?: { data?: { json?: { id: number; length: number } } } }>;
  const ev = body[0]?.result?.data?.json;
  if (!ev?.id)
    throw new Error(`event type ${username}/${slug} not resolvable via public/event (HTTP ${res.status})`);
  return { id: ev.id, length: ev.length };
}

async function getSlots(username: string, slug: string, length: number): Promise<string[]> {
  const from = new Date(Date.now() + 26 * 3600_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const input = {
    "0": {
      json: {
        eventTypeSlug: slug,
        usernameList: [username],
        startTime: `${from}T00:00:00Z`,
        endTime: `${to}T23:59:59Z`,
        timeZone: "Asia/Dubai",
        duration: String(length),
      },
    },
  };
  const res = await fetch(
    `${BASE}/api/trpc/slots/getSchedule?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`,
    { headers: { "user-agent": UA } }
  );
  const body = (await res.json()) as Array<{
    result?: { data?: { json?: { slots?: Record<string, { time: string }[]> } } };
  }>;
  const slots = Object.values(body[0]?.result?.data?.json?.slots ?? {})
    .flat()
    .map((s) => s.time);
  return slots.sort();
}

async function book(p: {
  eventTypeId: number;
  slug: string;
  start: string;
  length: number;
  name: string;
  email: string;
  language: Locale;
  rescheduleUid?: string;
}): Promise<{ uid: string; id: number }> {
  const end = new Date(new Date(p.start).getTime() + p.length * 60_000).toISOString();
  const res = await fetch(`${BASE}/api/book/event`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({
      eventTypeId: p.eventTypeId,
      eventTypeSlug: p.slug,
      start: p.start,
      end,
      timeZone: "Asia/Dubai",
      language: p.language,
      metadata: { source: "cc66-imap-matrix" },
      responses: { name: p.name, email: p.email, location: { value: "integrations:camv", optionValue: "" } },
      ...(p.rescheduleUid
        ? { rescheduleUid: p.rescheduleUid, rescheduleReason: "CC-66 matrix reschedule" }
        : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `book ${p.rescheduleUid ? "reschedule" : "create"} HTTP ${res.status}: ${text.slice(0, 300)}`
    );
  const data = JSON.parse(text) as { uid: string; id: number };
  return { uid: data.uid, id: data.id };
}

async function cancel(uid: string): Promise<void> {
  const csrf = await fetch(`${BASE}/api/csrf`, { headers: { "user-agent": UA } });
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = (csrf.headers.get("set-cookie") ?? "").split(";")[0];
  const res = await fetch(`${BASE}/api/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, cookie },
    body: JSON.stringify({ uid, cancellationReason: "CC-66 matrix cleanup", csrfToken }),
  });
  if (!res.ok) throw new Error(`cancel ${uid} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---------- minimal IMAP over TLS ----------

class Imap {
  private sock!: TLSSocket;
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private tagN = 0;

  async open(host: string): Promise<void> {
    this.sock = connect({ host, port: 993, servername: host });
    this.sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.waiters.splice(0).forEach((w) => w());
    });
    await this.readUntil((s) => s.includes("\r\n"));
    this.buf = Buffer.alloc(0);
  }

  private readUntil(done: (s: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("IMAP timeout")), 60_000);
      const check = () => {
        const s = this.buf.toString("latin1");
        if (done(s)) {
          clearTimeout(t);
          resolve(s);
        } else this.waiters.push(check);
      };
      check();
    });
  }

  async cmd(command: string): Promise<string> {
    const tag = `A${++this.tagN}`;
    this.buf = Buffer.alloc(0);
    this.sock.write(`${tag} ${command}\r\n`);
    const out = await this.readUntil((s) => new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`).test(s));
    const status = new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)([^\\r\\n]*)`).exec(out);
    if (status?.[2] !== "OK")
      throw new Error(`IMAP ${command.split(" ")[0]} failed: ${status?.[2]}${status?.[3]}`);
    return out;
  }

  async login(user: string, pass: string): Promise<void> {
    await this.cmd(`LOGIN ${quote(user)} ${quote(pass)}`);
  }

  // SASL-IR. On a bad token the server sends a "+ <base64 json>" challenge and waits;
  // answering with an empty line makes it return the tagged NO instead of hanging.
  async xoauth2(user: string, accessToken: string): Promise<void> {
    const tag = `A${++this.tagN}`;
    const tagged = new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)([^\\r\\n]*)`);
    this.buf = Buffer.alloc(0);
    this.sock.write(`${tag} AUTHENTICATE XOAUTH2 ${xoauth2Ir(user, accessToken)}\r\n`);
    let out = await this.readUntil((s) => tagged.test(s) || /(^|\r\n)\+ [^\r\n]*\r\n/.test(s));
    let challenge = "";
    if (!tagged.test(out)) {
      challenge = Buffer.from(/\+ ([^\r\n]*)/.exec(out)?.[1] ?? "", "base64").toString("utf8");
      this.sock.write("\r\n");
      out = await this.readUntil((s) => tagged.test(s));
    }
    const status = tagged.exec(out);
    if (status?.[2] !== "OK")
      throw new Error(`IMAP AUTHENTICATE XOAUTH2 failed: ${status?.[2]}${status?.[3]} ${challenge}`.trim());
  }

  async searchTo(addr: string): Promise<number[]> {
    const out = await this.cmd(`UID SEARCH TO ${quote(addr)}`);
    const line = /\* SEARCH([^\r\n]*)/.exec(out)?.[1] ?? "";
    return line.trim().split(/\s+/).filter(Boolean).map(Number);
  }

  async fetchRaw(uid: number): Promise<string> {
    const out = await this.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
    const m = /\{(\d+)\}\r\n/.exec(out);
    if (!m) throw new Error(`IMAP FETCH ${uid}: no literal`);
    const start = m.index + m[0].length;
    return Buffer.from(out, "latin1")
      .subarray(start, start + Number(m[1]))
      .toString("latin1");
  }

  async noop(): Promise<void> {
    await this.cmd("NOOP");
  }

  close(): void {
    this.sock.write(`Z LOGOUT\r\n`);
    this.sock.end();
  }
}

// Microsoft Graph transport for Outlook.com: the mailbox answers XOAUTH2 with "User is
// authenticated but not connected" on IMAP, but Graph reads the same raw RFC 822 message
// (GET /me/messages/{id}/$value), so the MIME/ICS/auth-header checks are unchanged.
// Graph ids are strings; they are mapped to stable small numbers to fit the Imap shape.
interface Mailbox {
  searchTo(addr: string): Promise<number[]>;
  fetchRaw(uid: number): Promise<string>;
  noop(): Promise<void>;
  close(): void;
}

class GraphMailbox implements Mailbox {
  private ids: string[] = [];
  private constructor(private token: string) {}

  static async open(refreshToken: string): Promise<GraphMailbox> {
    const clientId = process.env.CC66_MS_CLIENT_ID;
    if (!clientId) throw new Error("CC66_MS_CLIENT_ID not set (needed with CC66_OUTLOOK_GRAPH_REFRESH_TOKEN)");
    const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "https://graph.microsoft.com/Mail.Read offline_access",
      }),
    });
    const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!j.access_token)
      throw new Error(`MS Graph token refresh HTTP ${res.status}: ${j.error} ${(j.error_description ?? "").split("\r\n")[0]}`);
    return new GraphMailbox(j.access_token);
  }

  private async get(path: string): Promise<Response> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Graph GET ${path.split("?")[0].replace(/[0-9A-Za-z_=-]{20,}/g, "<id>")} HTTP ${res.status}`);
    return res;
  }

  async searchTo(addr: string): Promise<number[]> {
    // $filter on toRecipients is rejected for consumer mailboxes (HTTP 400), so list the newest
    // messages and match the recipient locally. Plus-addresses are unique per run.
    const j = (await (
      await this.get("/me/messages?$select=id,toRecipients&$orderby=receivedDateTime%20desc&$top=100")
    ).json()) as { value: { id: string; toRecipients?: { emailAddress?: { address?: string } }[] }[] };
    const want = addr.toLowerCase();
    j.value = j.value.filter((m) => (m.toRecipients ?? []).some((r) => r.emailAddress?.address?.toLowerCase() === want));
    return j.value.map((m) => {
      let i = this.ids.indexOf(m.id);
      if (i < 0) i = this.ids.push(m.id) - 1;
      return i + 1;
    });
  }

  async fetchRaw(uid: number): Promise<string> {
    const id = this.ids[uid - 1];
    if (!id) throw new Error(`Graph fetch: unknown uid ${uid}`);
    return Buffer.from(await (await this.get(`/me/messages/${encodeURIComponent(id)}/$value`)).arrayBuffer()).toString("latin1");
  }

  async noop(): Promise<void> {}
  close(): void {}
}

const xoauth2Ir = (user: string, token: string) =>
  Buffer.from(`user=${user}\x01auth=Bearer ${token}\x01\x01`, "utf8").toString("base64");

// Refresh tokens rotate on each use; the new one is not persisted, the stored one keeps
// working until its 90-day idle expiry.
async function msAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.CC66_MS_CLIENT_ID;
  const clientSecret = process.env.CC66_MS_CLIENT_SECRET;
  if (!clientId) throw new Error("CC66_MS_CLIENT_ID not set (needed with CC66_OUTLOOK_REFRESH_TOKEN)");
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token)
    throw new Error(`MS token refresh HTTP ${res.status}: ${j.error} ${(j.error_description ?? "").split("\r\n")[0]}`);
  return j.access_token;
}

async function imapSignIn(imap: Imap, provider: Provider, user: string, pass: string | undefined): Promise<void> {
  const cfg = PROVIDERS[provider];
  const refresh = "oauthEnv" in cfg ? process.env[cfg.oauthEnv] : undefined;
  if (refresh) return imap.xoauth2(user, await msAccessToken(refresh));
  if (!pass) throw new Error(`${cfg.passEnv} not set`);
  return imap.login(user, pass);
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ---------- MIME / ICS ----------

type Part = { headers: string; body: string };

function splitHeaders(raw: string): Part {
  const i = raw.search(/\r?\n\r?\n/);
  if (i < 0) return { headers: raw, body: "" };
  return { headers: raw.slice(0, i), body: raw.slice(i).replace(/^\r?\n\r?\n/, "") };
}

function header(headers: string, name: string): string[] {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  return unfolded
    .split(/\r?\n/)
    .filter((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    .map((l) => l.slice(name.length + 1).trim());
}

function decodeBody(p: Part): string {
  const enc = (header(p.headers, "content-transfer-encoding")[0] ?? "").toLowerCase();
  if (enc === "base64") return Buffer.from(p.body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (enc === "quoted-printable") {
    const bytes = p.body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return Buffer.from(p.body, "latin1").toString("utf8");
}

function calendarParts(p: Part): { ctype: string; text: string }[] {
  const ctype = header(p.headers, "content-type")[0] ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(ctype)?.[1];
  if (/^multipart\//i.test(ctype) && boundary) {
    return p.body
      .split(`--${boundary}`)
      .slice(1)
      .filter((s) => !s.startsWith("--"))
      .flatMap((s) => calendarParts(splitHeaders(s.replace(/^\r?\n/, ""))));
  }
  const disp = header(p.headers, "content-disposition")[0] ?? "";
  if (/text\/calendar|application\/ics/i.test(ctype) || /\.ics/i.test(disp) || /\.ics/i.test(ctype)) {
    return [{ ctype: ctype.split(";")[0].trim().toLowerCase(), text: decodeBody(p) }];
  }
  return [];
}

function icsProp(ics: string, name: string): string | undefined {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const m = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, "mi").exec(unfolded);
  return m?.[2]?.trim();
}

function vevent(ics: string): string {
  const m = /BEGIN:VEVENT[\s\S]*?END:VEVENT/i.exec(ics);
  return m ? m[0] : ics;
}

type Invite = {
  imapUid: number;
  date: string;
  subject: string;
  from: string;
  method?: string;
  uid?: string;
  sequence?: number;
  organizer?: string;
  dtstart?: string;
  partKinds: string[];
  auth: { spf: boolean; dkim: boolean; dmarc: boolean; raw: string };
};

function parseInvite(imapUid: number, raw: string): Invite {
  const top = splitHeaders(raw);
  const cal = calendarParts(top);
  const ics = cal[0]?.text ?? "";
  const authRaw = header(top.headers, "authentication-results")[0] ?? "";
  // The trailing guard stops a lookalike such as notify.timeway.co.example.net from aligning.
  // Escape every regex metacharacter (backslash included) so the domain is matched literally.
  const dom = `${EXPECT_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-]|\\.\\w)`;
  const organizer = icsProp(ics, "ORGANIZER")
    ?.replace(/^mailto:/i, "")
    .toLowerCase();
  const subjectRaw = header(top.headers, "subject")[0] ?? "";
  return {
    imapUid,
    date: header(top.headers, "date")[0] ?? "",
    subject: decodeMimeWords(subjectRaw),
    from: header(top.headers, "from")[0] ?? "",
    method: icsProp(ics, "METHOD")?.toUpperCase(),
    uid: icsProp(ics, "UID"),
    // RFC 5545 3.8.7.4: an absent SEQUENCE means 0.
    sequence: ics ? Number(icsProp(ics, "SEQUENCE") ?? 0) : undefined,
    organizer,
    // VTIMEZONE STANDARD/DAYLIGHT blocks carry their own DTSTART lines ahead of the VEVENT.
    dtstart: icsProp(vevent(ics), "DTSTART"),
    partKinds: cal.map((c) => c.ctype),
    auth: {
      // DKIM must be signed by the sending domain itself (aligned), not only by the ESP.
      dkim: new RegExp(`dkim=pass[^;]*header\\.(i|d)=@?(?:[\\w-]+\\.)*${dom}`, "i").test(authRaw),
      spf: new RegExp(`spf=pass[^;]*smtp\\.mailfrom=\"?(?:[^;\\s@]*@)?(?:[\\w-]+\\.)*${dom}`, "i").test(authRaw),
      dmarc: new RegExp(`dmarc=pass[^;]*header\\.from=${dom}`, "i").test(authRaw),
      // Bounce local parts can carry the attendee address; providers also echo them in comments.
      raw: authRaw.replace(/[^\s"'(<=@;]+@/g, "…@"),
    },
  };
}

function decodeMimeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, _cs: string, enc: string, txt: string) =>
    enc.toUpperCase() === "B"
      ? Buffer.from(txt, "base64").toString("utf8")
      : Buffer.from(
          txt
            .replace(/_/g, " ")
            .replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
          "latin1"
        ).toString("utf8")
  );
}

// ---------- matrix ----------

type Cell = {
  provider: Provider;
  locale: Locale;
  attendee: string;
  bookings: { step: Step; bookingUid: string; bookingId?: number; at: string }[];
  invites: Partial<Record<Step, Invite>>;
  error?: string;
};

async function waitForInvites(imap: Mailbox, addr: string, want: number, seen: Set<number>): Promise<Invite[]> {
  const deadline = Date.now() + POLL_MAX_MS;
  for (;;) {
    const uids = (await imap.searchTo(addr)).filter((u) => !seen.has(u));
    const found: Invite[] = [];
    for (const u of uids) {
      const inv = parseInvite(u, await imap.fetchRaw(u));
      if (inv.partKinds.length) found.push(inv);
    }
    if (found.length >= want || Date.now() > deadline) {
      found.forEach((f) => seen.add(f.imapUid));
      return found;
    }
    await sleep(POLL_MS);
    await imap.noop();
  }
}

async function runCell(provider: Provider, locale: Locale, runId: string): Promise<Cell> {
  const cfg = PROVIDERS[provider];
  const user = process.env[cfg.userEnv];
  const pass = process.env[cfg.passEnv];
  if (!user) throw new Error(`${cfg.userEnv} not set`);
  const [local, domain] = user.split("@");
  const attendee = `${local}+cc66-${runId}-${locale}@${domain}`;
  const cell: Cell = { provider, locale, attendee, bookings: [], invites: {} };
  const [username, slug] = HOSTS[locale].split("/");

  const graphRefresh = provider === "outlook" ? process.env.CC66_OUTLOOK_GRAPH_REFRESH_TOKEN : undefined;
  let imap: Mailbox;
  if (graphRefresh) {
    imap = await GraphMailbox.open(graphRefresh);
  } else {
    const im = new Imap();
    await im.open(cfg.imapHost);
    await imapSignIn(im, provider, user, pass);
    await im.cmd("SELECT INBOX");
    imap = im;
  }
  const seen = new Set<number>(await imap.searchTo(attendee));

  let liveUid: string | undefined;
  try {
    const et = await getEventTypeId(username, slug);
    const slots = await getSlots(username, slug, et.length);
    if (slots.length < 2) throw new Error(`fewer than 2 open slots on ${HOSTS[locale]}`);
    // Spread cells over different slots so parallel cells never collide.
    const offset = (provider === "gmail" ? 0 : 4) + (locale === "en" ? 0 : 2);
    const [s1, s2] = [slots[offset % slots.length], slots[(offset + 1) % slots.length]];
    const name = locale === "ar" ? "اختبار CC-66" : "CC-66 matrix";

    const steps: Step[] = ["create", "reschedule", "cancel"];
    for (const step of steps) {
      const at = new Date().toISOString();
      if (step === "create") {
        const b = await book({
          eventTypeId: et.id,
          slug,
          start: s1,
          length: et.length,
          name,
          email: attendee,
          language: locale,
        });
        liveUid = b.uid;
        cell.bookings.push({ step, bookingUid: b.uid, bookingId: b.id, at });
      } else if (step === "reschedule") {
        const b = await book({
          eventTypeId: et.id,
          slug,
          start: s2,
          length: et.length,
          name,
          email: attendee,
          language: locale,
          rescheduleUid: liveUid,
        });
        liveUid = b.uid;
        cell.bookings.push({ step, bookingUid: b.uid, bookingId: b.id, at });
      } else {
        await cancel(liveUid!);
        cell.bookings.push({ step, bookingUid: liveUid!, at });
        liveUid = undefined;
      }
      log(`${provider}/${locale} ${step} done, polling IMAP`);
      const got = await waitForInvites(imap, attendee, 1, seen);
      if (!got.length) {
        cell.error = `no calendar mail for ${step} within ${POLL_MAX_MS / 60000} min`;
        break;
      }
      cell.invites[step] = got[got.length - 1];
    }
  } catch (e) {
    cell.error = (e as Error).message;
  } finally {
    if (liveUid) {
      // Never leave a test booking behind, whatever failed above.
      await cancel(liveUid).catch(
        (e: Error) => (cell.error = `${cell.error ?? ""}; cleanup cancel failed: ${e.message}`)
      );
    }
    imap.close();
  }
  return cell;
}

type Row = {
  provider: Provider;
  locale: Locale;
  check: "invite-chain" | "auth-aligned";
  pass: boolean;
  detail: string;
};

function rowsFor(c: Cell): Row[] {
  const a = c.invites.create;
  const b = c.invites.reschedule;
  const x = c.invites.cancel;
  const chain: string[] = [];
  let chainOk = !c.error && !!a && !!b && !!x;
  if (a && b && x) {
    const methods = [a.method, b.method, x.method].join(",");
    const mOk = methods === "REQUEST,REQUEST,CANCEL";
    const uOk = !!a.uid && a.uid === b.uid && b.uid === x.uid;
    const sOk = a.sequence! < b.sequence! && b.sequence! < x.sequence!;
    const orgs = [a.organizer, b.organizer, x.organizer];
    const oOk = orgs.every((o) => o === EXPECT_ORGANIZER);
    chainOk = chainOk && mOk && uOk && sOk && oOk;
    chain.push(
      `METHOD ${methods} ${mOk ? "ok" : "FAIL"}`,
      `UID ${uOk ? "same" : `DIFFERS (${[a.uid, b.uid, x.uid].join(" | ")})`}`,
      `SEQUENCE ${[a.sequence, b.sequence, x.sequence].join("→")} ${sOk ? "ok" : "FAIL"}`,
      `ORGANIZER ${oOk ? EXPECT_ORGANIZER : `FAIL (${orgs.join(" | ")})`}`
    );
  } else {
    chain.push(
      `missing: ${(["create", "reschedule", "cancel"] as Step[]).filter((s) => !c.invites[s]).join(",")}`
    );
  }
  if (c.error) chain.push(`error: ${c.error}`);
  const invs = [a, b, x].filter(Boolean) as Invite[];
  const authOk = invs.length === 3 && invs.every((i) => i.auth.spf && i.auth.dkim && i.auth.dmarc);
  const authDetail = invs
    .map(
      (i) =>
        `spf=${i.auth.spf ? "pass" : "FAIL"} dkim=${i.auth.dkim ? "pass" : "FAIL"} dmarc=${i.auth.dmarc ? "pass" : "FAIL"}`
    )
    .join(" / ");
  return [
    {
      provider: c.provider,
      locale: c.locale,
      check: "invite-chain",
      pass: chainOk,
      detail: chain.join("; "),
    },
    {
      provider: c.provider,
      locale: c.locale,
      check: "auth-aligned",
      pass: authOk,
      detail: authDetail || "no mail",
    },
  ];
}

function markdown(runId: string, cells: Cell[], rows: Row[], skipped: string[]): string {
  const lines = [
    `# CC-66 IMAP matrix, run ${runId}`,
    "",
    `Script: \`scripts/cc66-imap-matrix.ts\`. Target: ${BASE}. Expected ORGANIZER: ${EXPECT_ORGANIZER}. Aligned domain: ${EXPECT_DOMAIN}.`,
    "",
    `Result: ${rows.filter((r) => r.pass).length}/${rows.length} rows pass${skipped.length ? `; not run: ${skipped.join(", ")}` : ""}.`,
    "",
    "| Mailbox | Locale | Check | Result | Detail |",
    "|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.provider} | ${r.locale.toUpperCase()} | ${r.check} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")} |`
    ),
    "",
    "## Bookings and messages",
    "",
  ];
  for (const c of cells) {
    lines.push(`### ${c.provider} ${c.locale.toUpperCase()}`, "");
    for (const b of c.bookings)
      lines.push(
        `- ${b.step}: booking uid \`${b.bookingUid}\`${b.bookingId ? ` (id ${b.bookingId})` : ""} at ${b.at}`
      );
    for (const s of ["create", "reschedule", "cancel"] as Step[]) {
      const i = c.invites[s];
      if (!i) continue;
      lines.push(
        `- ${s} mail: IMAP uid ${i.imapUid}, ${i.date}, subject "${i.subject}", parts ${i.partKinds.join("+")}, METHOD ${i.method}, UID \`${i.uid}\`, SEQUENCE ${i.sequence}, ORGANIZER ${i.organizer}, DTSTART ${i.dtstart}`,
        `  - Authentication-Results: \`${i.auth.raw}\``
      );
    }
    if (c.error) lines.push(`- error: ${c.error}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const providers = (process.env.CC66_MAILBOXES ?? "gmail").split(",").map((s) => s.trim()) as Provider[];
  const skipped = (Object.keys(PROVIDERS) as Provider[]).filter((p) => !providers.includes(p));
  const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).toLowerCase();
  const cells: Cell[] = [];
  for (const p of providers) {
    for (const l of ["en", "ar"] as Locale[]) {
      log(`cell ${p}/${l} start`);
      cells.push(await runCell(p, l, runId));
    }
  }
  const rows = cells.flatMap(rowsFor);
  mkdirSync(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const json = {
    runId,
    base: BASE,
    expectOrganizer: EXPECT_ORGANIZER,
    expectDomain: EXPECT_DOMAIN,
    skipped,
    rows,
    cells,
  };
  writeFileSync(join(OUT_DIR, `${date}-${runId}.json`), `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, `${date}-${runId}.md`), markdown(runId, cells, rows, skipped));
  log(
    `wrote ${OUT_DIR}/${date}-${runId}.{md,json}: ${rows.filter((r) => r.pass).length}/${rows.length} pass`
  );
  if (rows.some((r) => !r.pass)) process.exitCode = 1;
}

// ---------- offline self-test (--selftest) ----------

// Synthetic REQUEST/REQUEST/CANCEL mails in scripts/cc66-fixtures/ (example.com attendee,
// TEST-NET IP). Negative cases prove each check can fail, so a green live run means something.
function selftest(): void {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "cc66-fixtures");
  const load = (s: Step, i: number) => parseInvite(100 + i, readFileSync(join(dir, `${s}.eml`), "latin1"));
  const steps: Step[] = ["create", "reschedule", "cancel"];
  const invites = Object.fromEntries(steps.map((s, i) => [s, load(s, i)])) as Record<Step, Invite>;
  const cell = (inv: Partial<Record<Step, Invite>>): Cell => ({
    provider: "gmail",
    locale: "en",
    attendee: "guest+cc66-fixture@example.com",
    bookings: [],
    invites: inv,
  });
  let n = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    n++;
    console.log(`${ok ? "ok  " : "FAIL"} ${n} ${name}${detail ? ` (${detail})` : ""}`);
    if (!ok) process.exitCode = 1;
  };

  for (const s of steps) {
    const i = invites[s];
    check(
      `${s}: calendar parts found`,
      i.partKinds.join("+") === "text/calendar+application/ics",
      i.partKinds.join("+")
    );
    check(`${s}: ORGANIZER`, i.organizer === EXPECT_ORGANIZER, i.organizer);
    check(`${s}: spf/dkim/dmarc=pass d=${EXPECT_DOMAIN}`, i.auth.spf && i.auth.dkim && i.auth.dmarc);
    check(`${s}: mailfrom local part masked`, !/bounces\+0@/.test(i.auth.raw));
  }
  const { create: a, reschedule: b, cancel: x } = invites;
  check(
    "METHOD REQUEST,REQUEST,CANCEL",
    [a.method, b.method, x.method].join(",") === "REQUEST,REQUEST,CANCEL"
  );
  check("same UID", !!a.uid && a.uid === b.uid && b.uid === x.uid, a.uid);
  check(
    "SEQUENCE strictly increasing",
    a.sequence! < b.sequence! && b.sequence! < x.sequence!,
    [a.sequence, b.sequence, x.sequence].join("→")
  );
  check(
    "quoted-printable part + RFC 2047 subject decoded",
    b.subject === "Rescheduled: CC-66 fixture" && b.dtstart === "20261111T090000Z",
    b.subject
  );

  const rows = rowsFor(cell(invites));
  check("rowsFor: invite-chain PASS", rows[0].pass, rows[0].detail);
  check("rowsFor: auth-aligned PASS", rows[1].pass, rows[1].detail);

  // Negative cases.
  const rowsOf = (inv: Partial<Record<Step, Invite>>) => rowsFor(cell(inv));
  check("neg: missing cancel fails chain", !rowsOf({ create: a, reschedule: b }).some((r) => r.pass));
  check(
    "neg: equal SEQUENCE fails chain",
    !rowsOf({ create: a, reschedule: { ...b, sequence: a.sequence }, cancel: x })[0].pass
  );
  check(
    "neg: new UID on reschedule fails chain",
    !rowsOf({ create: a, reschedule: { ...b, uid: "other" }, cancel: x })[0].pass
  );
  check(
    "neg: REQUEST instead of CANCEL fails chain",
    !rowsOf({ create: a, reschedule: b, cancel: { ...x, method: "REQUEST" } })[0].pass
  );
  check(
    "neg: foreign ORGANIZER fails chain",
    !rowsOf({ create: a, reschedule: b, cancel: { ...x, organizer: "noreply@example.com" } })[0].pass
  );
  const espOnly = readFileSync(join(dir, "create.eml"), "latin1")
    .replace("header.i=@notify.timeway.co", "header.i=@esp.example.net")
    .replace('smtp.mailfrom="bounces+0@notify.timeway.co"', 'smtp.mailfrom="bounces@esp.example.net"')
    .replace("header.from=notify.timeway.co", "header.from=esp.example.net");
  const e = parseInvite(200, espOnly);
  check("neg: ESP-only dkim/spf/dmarc not aligned", !e.auth.dkim && !e.auth.spf && !e.auth.dmarc);
  check("neg: unaligned mail fails auth row", !rowsOf({ create: e, reschedule: b, cancel: x })[1].pass);
  const lookalike = parseInvite(
    201,
    readFileSync(join(dir, "create.eml"), "latin1").replace(
      /notify\.timeway\.co/g,
      "notify.timeway.co.example.net"
    )
  );
  check(
    "neg: lookalike notify.timeway.co.example.net not aligned",
    !lookalike.auth.dkim && !lookalike.auth.spf && !lookalike.auth.dmarc
  );

  // Outlook.com writes smtp.mailfrom as a bare domain (no local part); Gmail writes the full address.
  const ms = parseInvite(
    203,
    readFileSync(join(dir, "create.eml"), "latin1").replace(
      /smtp\.mailfrom="bounces\+0@notify\.timeway\.co"/,
      "smtp.mailfrom=em5498.notify.timeway.co"
    )
  );
  check("outlook-style bare-domain smtp.mailfrom aligns", ms.auth.spf);
  const msBad = parseInvite(
    204,
    readFileSync(join(dir, "create.eml"), "latin1").replace(
      /smtp\.mailfrom="bounces\+0@notify\.timeway\.co"/,
      "smtp.mailfrom=em5498.notify.timeway.co.example.net"
    )
  );
  check("neg: bare-domain lookalike smtp.mailfrom not aligned", !msBad.auth.spf);

  const withTz = parseInvite(
    202,
    readFileSync(join(dir, "reschedule.eml"), "latin1").replace(
      "BEGIN:VEVENT",
      "BEGIN:VTIMEZONE\r\nTZID:Europe/London\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT"
    )
  );
  check("DTSTART read from VEVENT, not VTIMEZONE", withTz.dtstart === "20261111T090000Z", withTz.dtstart);

  // RFC 7628 / Microsoft XOAUTH2 initial response: user=<u>^Aauth=Bearer <t>^A^A, base64.
  const ir = Buffer.from(xoauth2Ir("someone@example.com", "tok"), "base64").toString("latin1");
  check("XOAUTH2 initial response format", ir === "user=someone@example.com\x01auth=Bearer tok\x01\x01");
  check("XOAUTH2 only on outlook", "oauthEnv" in PROVIDERS.outlook && !("oauthEnv" in PROVIDERS.gmail));

  console.log(process.exitCode ? `selftest FAILED` : `selftest: ${n}/${n} ok`);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(2);
  });
}
