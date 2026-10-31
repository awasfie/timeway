#!/usr/bin/env python3
"""Booking-page edge cache Worker for timeway.co as code (WC-TW-6g).

  plan      show what apply would change: script content hash and Worker routes (default, read-only)
  apply     upload worker/booking-edge.mjs (+ locales.mjs, defer-js.mjs) and set the routes in timeway-worker.json;
            the pre-apply routes are saved for rollback
  rollback  remove the managed routes (traffic goes straight to the origin again) and restore any routes
            saved by the last apply; the script itself is deleted with --delete-script
  purge     purge the given URLs from the zone cache (edge-cached booking HTML otherwise ages out within
            MAX_STALE_S of worker/booking-edge.mjs; the Worker's Cache API keys are internal, so rollback is
            the way to stop serving them at once)

Token: env CLOUDFLARE_API_TOKEN, or --token-file PATH. Scope: Account Workers Scripts Write, Zone Workers
Routes Write + Zone Read + Cache Purge on timeway.co (stored as CLOUDFLARE_TIMEWAY_WORKER_TOKEN in Infisical
platform:/cloudflare). The value is never printed. Stdlib only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

API = "https://api.cloudflare.com/client/v4"
HERE = Path(__file__).resolve().parent
SPEC = HERE / "timeway-worker.json"
BACKUP_DIR = Path(os.environ.get("TW_CF_BACKUP_DIR", Path.home() / ".cache" / "timeway-cloudflare"))


class CF:
    def __init__(self, token: str):
        self._auth = f"Bearer {token}"

    def call(self, method: str, path: str, body: object | None = None, raw: bytes | None = None,
             ctype: str = "application/json") -> tuple[int, dict]:
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        headers = {"Authorization": self._auth, "Content-Type": ctype}
        for attempt in range(3):
            req = urllib.request.Request(API + path, method=method, headers=headers, data=data)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read() or b"{}")
            except (TimeoutError, urllib.error.URLError, ConnectionError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        raise AssertionError("unreachable")

    def ok(self, method: str, path: str, **kw) -> Any:
        status, out = self.call(method, path, **kw)
        if status >= 300 or not out.get("success", False):
            errs = [f"{e.get('code')}: {e.get('message')}" for e in out.get("errors", [])]
            sys.exit(f"cloudflare {method} {path} -> {status} {errs}")
        return out.get("result")


def bundle(spec: dict) -> tuple[dict[str, bytes], str]:
    files = {name: (HERE / "worker" / name).read_bytes() for name in spec["modules"]}
    digest = hashlib.sha256(b"".join(k.encode() + b"\0" + v for k, v in sorted(files.items()))).hexdigest()[:16]
    return files, digest


def multipart(spec: dict, files: dict[str, bytes], digest: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    meta = {
        "main_module": spec["modules"][0],
        "compatibility_date": spec["compatibility_date"],
        "bindings": [{"type": "plain_text", "name": "TW_BUNDLE", "text": digest}],
    }
    parts = [("metadata", "metadata.json", "application/json", json.dumps(meta).encode())]
    parts += [(name, name, "application/javascript+module", body) for name, body in files.items()]
    out = b""
    for field, fname, ctype, body in parts:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{fname}\"\r\n"
                f"Content-Type: {ctype}\r\n\r\n").encode() + body + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


def live_digest(cf: CF, acct: str, script: str) -> str | None:
    status, out = cf.call("GET", f"/accounts/{acct}/workers/scripts/{script}/settings")
    if status == 404:
        return None
    if status >= 300:
        sys.exit(f"read script settings -> {status} {out.get('errors')}")
    for b in out["result"].get("bindings", []):
        if b.get("name") == "TW_BUNDLE":
            return b.get("text")
    return "unknown"


def desired_routes(spec: dict) -> list[tuple[str, str | None]]:
    return [(p, spec["script"]) for p in spec["routes"]] + [(p, None) for p in spec["excluded_routes"]]


def route_plan(live: list[dict], spec: dict) -> tuple[list, list, list]:
    by_pattern = {r["pattern"]: r for r in live}
    add, change = [], []
    for pattern, script in desired_routes(spec):
        cur = by_pattern.get(pattern)
        if cur is None:
            add.append((pattern, script))
        elif (cur.get("script") or None) != script:
            change.append((cur["id"], pattern, script))
    wanted = {p for p, _ in desired_routes(spec)}
    stale = [r for r in live if r.get("script") == spec["script"] and r["pattern"] not in wanted]
    return add, change, stale


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="plan", choices=["plan", "apply", "rollback", "purge"])
    ap.add_argument("--token-file")
    ap.add_argument("--yes", action="store_true", help="required for apply/rollback/purge")
    ap.add_argument("--delete-script", action="store_true", help="rollback: also delete the Worker script")
    ap.add_argument("urls", nargs="*", help="purge: full URLs")
    args = ap.parse_args()

    token = Path(args.token_file).read_text().strip() if args.token_file else os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        sys.exit("set CLOUDFLARE_API_TOKEN or pass --token-file")
    spec = json.loads(SPEC.read_text())
    cf = CF(token)
    zones = cf.ok("GET", f"/zones?name={spec['zone']}")
    if not zones:
        sys.exit(f"zone {spec['zone']} not visible to this token")
    zid, acct = zones[0]["id"], zones[0]["account"]["id"]
    files, digest = bundle(spec)
    live = cf.ok("GET", f"/zones/{zid}/workers/routes") or []
    managed = {p for p, _ in desired_routes(spec)}
    backup = BACKUP_DIR / f"{spec['zone']}.workers-routes.pre-apply.json"

    if args.command == "plan":
        cur = live_digest(cf, acct, spec["script"])
        print(f"script {spec['script']}: live={cur or 'absent'} local={digest} -> {'no change' if cur == digest else 'upload'}")
        add, change, stale = route_plan(live, spec)
        for p, s in add:
            print(f"+ route {p} -> {s or '(no worker)'}")
        for _, p, s in change:
            print(f"~ route {p} -> {s or '(no worker)'}")
        for r in stale:
            print(f"- route {r['pattern']} ({r['id']})")
        if not (add or change or stale):
            print("routes: no changes")
        return

    if not args.yes:
        sys.exit(f"{args.command} writes to Cloudflare; re-run with --yes after reviewing `plan`")

    if args.command == "purge":
        if not args.urls:
            sys.exit("purge needs one or more URLs")
        cf.ok("POST", f"/zones/{zid}/purge_cache", body={"files": args.urls})
        print(f"purged {len(args.urls)} url(s) from the zone cache")
        return

    if args.command == "apply":
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            keep = [r for r in live if r["pattern"] in managed or r.get("script") == spec["script"]]
            backup.write_text(json.dumps({"saved_at": int(time.time()), "routes": keep}, indent=2))
        if live_digest(cf, acct, spec["script"]) != digest:
            body, ctype = multipart(spec, files, digest)
            cf.ok("PUT", f"/accounts/{acct}/workers/scripts/{spec['script']}", raw=body, ctype=ctype)
            print(f"uploaded script {spec['script']} bundle {digest}")
        add, change, stale = route_plan(live, spec)
        # exclusions first so no excluded path is ever served by the Worker in between
        for p, s in sorted(add, key=lambda x: x[1] is not None):
            body = {"pattern": p, **({"script": s} if s else {})}
            cf.ok("POST", f"/zones/{zid}/workers/routes", body=body)
            print(f"+ route {p} -> {s or '(no worker)'}")
        for rid, p, s in change:
            cf.ok("PUT", f"/zones/{zid}/workers/routes/{rid}", body={"pattern": p, **({"script": s} if s else {})})
            print(f"~ route {p} -> {s or '(no worker)'}")
        for r in stale:
            cf.ok("DELETE", f"/zones/{zid}/workers/routes/{r['id']}")
            print(f"- route {r['pattern']}")
        print(f"applied; backup {backup}")
        return

    # rollback: Worker routes first (stops serving cached HTML at once), then the exclusions
    saved = json.loads(backup.read_text())["routes"] if backup.exists() else []
    ordered = sorted(live, key=lambda r: r.get("script") is None)
    for r in ordered:
        if r["pattern"] in managed or r.get("script") == spec["script"]:
            cf.ok("DELETE", f"/zones/{zid}/workers/routes/{r['id']}")
            print(f"- route {r['pattern']}")
    for r in saved:
        cf.ok("POST", f"/zones/{zid}/workers/routes", body={"pattern": r["pattern"], **({"script": r["script"]} if r.get("script") else {})})
        print(f"+ restored route {r['pattern']}")
    if args.delete_script:
        status, out = cf.call("DELETE", f"/accounts/{acct}/workers/scripts/{spec['script']}")
        print(f"script delete -> {status}")
    backup.unlink(missing_ok=True)
    print("rolled back")


if __name__ == "__main__":
    main()
