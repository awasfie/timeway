import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_SKEW_SECONDS, verifySendgridSignature } from "../verifySendgridSignature";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const NOW = 1_792_600_000;
const body = JSON.stringify([{ sg_event_id: "e1", event: "delivered", timestamp: NOW }]);
const signWith = (key: typeof privateKey, ts: string, payload: string) =>
  sign("sha256", Buffer.from(ts + payload, "utf8"), key).toString("base64");

describe("verifySendgridSignature", () => {
  it("accepts a good signature within the skew window", () => {
    const ts = String(NOW - 60);
    const res = verifySendgridSignature({
      publicKey: publicKeyB64,
      signature: signWith(privateKey, ts, body),
      timestamp: ts,
      rawBody: body,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const ts = String(NOW);
    const res = verifySendgridSignature({
      publicKey: publicKeyB64,
      signature: signWith(privateKey, ts, body),
      timestamp: ts,
      rawBody: body.replace("delivered", "bounce"),
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature from another key", () => {
    const ts = String(NOW);
    const res = verifySendgridSignature({
      publicKey: publicKeyB64,
      signature: signWith(other.privateKey, ts, body),
      timestamp: ts,
      rawBody: body,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a stale timestamp even when correctly signed", () => {
    const ts = String(NOW - MAX_SKEW_SECONDS - 1);
    const res = verifySendgridSignature({
      publicKey: publicKeyB64,
      signature: signWith(privateKey, ts, body),
      timestamp: ts,
      rawBody: body,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a future timestamp beyond the window", () => {
    const ts = String(NOW + MAX_SKEW_SECONDS + 1);
    const res = verifySendgridSignature({
      publicKey: publicKeyB64,
      signature: signWith(privateKey, ts, body),
      timestamp: ts,
      rawBody: body,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects unsigned requests and a missing key", () => {
    expect(
      verifySendgridSignature({ publicKey: publicKeyB64, signature: null, timestamp: null, rawBody: body })
    ).toEqual({ ok: false, reason: "unsigned" });
    expect(
      verifySendgridSignature({ publicKey: undefined, signature: "x", timestamp: String(NOW), rawBody: body })
    ).toEqual({ ok: false, reason: "no_key" });
  });

  it("rejects a non-numeric timestamp and garbage signature without throwing", () => {
    expect(
      verifySendgridSignature({ publicKey: publicKeyB64, signature: "abc", timestamp: "1e9", rawBody: body })
    ).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(
      verifySendgridSignature({
        publicKey: publicKeyB64,
        signature: "not-base64-der",
        timestamp: String(NOW),
        rawBody: body,
        nowSeconds: NOW,
      })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
