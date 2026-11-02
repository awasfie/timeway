#!/usr/bin/env python3
"""Cloudflare cache rules for timeway.co as code (WC-TW-6b).

  plan      show the diff between the live phase entrypoint and timeway-cache-rules.json (default, read-only)
  apply     write the desired managed rules; foreign rules are kept; the pre-apply ruleset is saved
  rollback  restore the ruleset saved by the last apply (or drop the managed rules if no backup exists)

Token: env CLOUDFLARE_API_TOKEN, or --token-file PATH. Scope needed: Zone Read + Cache Settings Read/Write on
timeway.co (stored as CLOUDFLARE_TIMEWAY_CACHE_TOKEN in Infisical platform:/cloudflare). The value is never printed.
Stdlib only.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
HERE = Path(__file__).resolve().parent
SPEC = HERE / "timeway-cache-rules.json"
BACKUP_DIR = Path(os.environ.get("TW_CF_BACKUP_DIR", Path.home() / ".cache" / "timeway-cloudflare"))
RULE_FIELDS = ("ref", "description", "expression", "action", "action_parameters", "enabled")


class CF:
    def __init__(self, token: str):
        self._h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def call(self, method: str, path: str, body: object | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(API + path, method=method, headers=self._h, data=data)
        # GET and PUT of a whole entrypoint are idempotent, so a timed-out call is safe to repeat
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read() or b"{}")
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        raise AssertionError("unreachable")

    def ok(self, method: str, path: str, body: object | None = None) -> dict:
        status, out = self.call(method, path, body)
        if status >= 300 or not out.get("success", False):
            errs = [f"{e.get('code')}: {e.get('message')}" for e in out.get("errors", [])]
            sys.exit(f"cloudflare {method} {path} -> {status} {errs}")
        return out["result"]


def is_managed(rule: dict, prefix: str) -> bool:
    return str(rule.get("ref", "")).startswith(prefix) or str(rule.get("description", "")).startswith("WC-TW-6b:")


def norm(rule: dict) -> dict:
    return {k: rule[k] for k in RULE_FIELDS if k in rule}


def zone_id(cf: CF, name: str) -> str:
    res = cf.ok("GET", f"/zones?name={name}")
    if not res:
        sys.exit(f"zone {name} not visible to this token")
    return res[0]["id"]


def live_rules(cf: CF, zid: str, phase: str) -> list[dict] | None:
    status, out = cf.call("GET", f"/zones/{zid}/rulesets/phases/{phase}/entrypoint")
    if status == 404:
        return None
    if status >= 300:
        sys.exit(f"read entrypoint -> {status} {out.get('errors')}")
    return out["result"].get("rules", [])


def desired_rules(live: list[dict] | None, spec: dict) -> list[dict]:
    foreign = [norm(r) for r in (live or []) if not is_managed(r, spec["managed_ref_prefix"])]
    # managed rules go last so the cookie/api bypass keeps the final word over any foreign rule
    return foreign + [norm(r) for r in spec["rules"]]


def show_diff(before: list[dict], after: list[dict]) -> bool:
    a = json.dumps(before, indent=2, sort_keys=True).splitlines()
    b = json.dumps(after, indent=2, sort_keys=True).splitlines()
    diff = list(difflib.unified_diff(a, b, "live", "desired", lineterm=""))
    print("\n".join(diff) if diff else "no changes")
    return bool(diff)


def put_rules(cf: CF, zid: str, phase: str, rules: list[dict]) -> dict:
    return cf.ok("PUT", f"/zones/{zid}/rulesets/phases/{phase}/entrypoint", {"rules": rules})


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="plan", choices=["plan", "apply", "rollback"])
    ap.add_argument("--token-file")
    ap.add_argument("--yes", action="store_true", help="required for apply/rollback")
    args = ap.parse_args()

    token = Path(args.token_file).read_text().strip() if args.token_file else os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        sys.exit("set CLOUDFLARE_API_TOKEN or pass --token-file")
    spec = json.loads(SPEC.read_text())
    cf = CF(token)
    zid = zone_id(cf, spec["zone"])
    phase = spec["phase"]
    live = live_rules(cf, zid, phase)
    live_norm = [norm(r) for r in live or []]
    backup = BACKUP_DIR / f"{spec['zone']}.{phase}.pre-apply.json"

    if args.command == "plan":
        print(f"zone={spec['zone']} phase={phase} entrypoint={'absent' if live is None else f'{len(live)} rules'}")
        show_diff(live_norm, desired_rules(live, spec))
        return

    if not args.yes:
        sys.exit(f"{args.command} writes to Cloudflare; re-run with --yes after reviewing `plan`")

    if args.command == "apply":
        target = desired_rules(live, spec)
        if not show_diff(live_norm, target):
            return
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        # keep the oldest pre-apply state: a second apply must not turn rollback into "undo the last edit"
        if not backup.exists():
            backup.write_text(json.dumps({"saved_at": int(time.time()), "existed": live is not None, "rules": live_norm}, indent=2))
        res = put_rules(cf, zid, phase, target)
        print(f"applied: ruleset {res['id']} version {res.get('version')} rules={len(res.get('rules', []))}; backup {backup}")
        return

    if backup.exists():
        saved = json.loads(backup.read_text())
        target = saved["rules"]
        source = f"backup {backup} ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(saved['saved_at']))})"
    else:
        target = [r for r in live_norm if not is_managed(r, spec["managed_ref_prefix"])]
        source = "no backup: dropping managed rules only"
    print(f"rollback from {source}")
    if not show_diff(live_norm, target):
        backup.unlink(missing_ok=True)
        return
    res = put_rules(cf, zid, phase, target)
    backup.unlink(missing_ok=True)
    print(f"rolled back: ruleset {res['id']} version {res.get('version')} rules={len(res.get('rules', []))}")


if __name__ == "__main__":
    main()
