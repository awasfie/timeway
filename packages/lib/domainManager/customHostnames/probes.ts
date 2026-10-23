import { promises as dns } from "node:dns";
import https from "node:https";

export type CnameLookup = (hostname: string) => Promise<string[]>;
export type HttpsProbeResult = { ok: true } | { ok: false; error: string };
export type HttpsProbe = (hostname: string) => Promise<HttpsProbeResult>;

/** Direct CNAME answers only; NXDOMAIN / no CNAME record resolve to []. */
export const lookupCname: CnameLookup = async (hostname) => {
  try {
    return await dns.resolveCname(hostname);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOTIMP") return [];
    throw e;
  }
};

const PROBE_TIMEOUT_MS = 5000;

/**
 * Any HTTP response over a certificate Node trusts for this exact name means the
 * proxy has issued one; the status code is irrelevant to that question.
 */
export const probeHttps: HttpsProbe = (hostname) =>
  new Promise((resolve) => {
    const req = https.request(
      {
        host: hostname,
        servername: hostname,
        port: 443,
        method: "HEAD",
        path: "/",
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve({ ok: true });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err: NodeJS.ErrnoException) => resolve({ ok: false, error: err.code || err.message }));
    req.end();
  });
