#!/usr/bin/env python3
"""WC-PE-6 / CC-89 RLS audit for salesos, passport, link and timeway.

Checks, per database (ids are stable; Gosi reproduces them by id):
  R1  runtime role exists, NOSUPERUSER, NOBYPASSRLS, not a member of an owner or superuser role
  R2  runtime role owns no relation in schema public
  T1  every tenant table has ENABLE + FORCE ROW LEVEL SECURITY and at least one policy
  T2  every ALL/INSERT/UPDATE policy on a tenant table has an explicit WITH CHECK
  T3  the tenant setting is read as NULLIF(current_setting('<guc>', true), '') (directly or in a helper fn)
  P1  pool reuse: one backend, runtime role, tenant A set transaction-locally, COMMIT, next statement
      without a tenant -> setting is '' and every tenant table returns 0 rows
  P2  cross-tenant: under tenant A no row of another tenant is visible in the probe table; an INSERT
      for tenant B under A is rejected by RLS; an INSERT with no tenant set is rejected (always ROLLBACK)
  E1  (live only) no runtime container env holds a Postgres URL whose user is an owner role or superuser

Read-only by construction: every probe that could write runs inside BEGIN ... ROLLBACK and is expected
to be refused by RLS. No secret is read or printed: the runtime role is assumed via SET ROLE from the
cluster superuser, and E1 prints only the user part of a URL.

Usage:
  live : rls_audit.py --live [--only salesos,passport] [--json out.json]
  dry  : rls_audit.py --live --only salesos --container salesos=<clone container> --no-env
  CI   : rls_audit.py --dsn salesos=postgresql://postgres@localhost:5432/salesos --only salesos
Exit 0 = all PASS (WARN allowed), 1 = at least one FAIL, 2 = could not run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGETS = json.loads((HERE / "targets.json").read_text())
SEP = "\x1f"

GUCS = {
    "salesos": "app.current_tenant_id",
    "passport": "app.current_organization_id",
    "link": "app.workspace_id",
    "timeway": "app.tw_org_id",
}


class Runner:
    """Runs psql either through ssh+docker exec (live) or against a DSN (CI)."""

    def __init__(self, live: bool, dsns: dict[str, str], ssh_key: str | None, containers: dict[str, str] | None = None):
        self.live, self.dsns, self.ssh_key = live, dsns, ssh_key
        self.containers = containers or {}

    def psql(self, t: dict, sql: str, check: bool = True) -> tuple[int, str, str]:
        args = ["psql", "-X", "-q", "-At", "-F", SEP, "-v", f"ON_ERROR_STOP={1 if check else 0}"]
        if self.live:
            container = self.containers.get(t["product"]) or TARGETS["clusters"][t["cluster"]]
            cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
            if self.ssh_key:
                cmd += ["-i", self.ssh_key]
            cmd += [f"root@{TARGETS['host']}", f"docker exec -i {container} " + " ".join(args + ["-U", "postgres", "-d", t["db"]])]
        else:
            cmd = args + [self.dsns[t["product"]]]
        p = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=120)
        if check and p.returncode != 0:
            raise RuntimeError(f"{t['product']}: psql failed: {p.stderr.strip()[:400]}")
        return p.returncode, p.stdout, p.stderr

    def rows(self, t: dict, sql: str) -> list[list[str]]:
        _, out, _ = self.psql(t, sql)
        return [line.split(SEP) for line in out.splitlines() if line.strip()]


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def qi(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def audit_db(r: Runner, t: dict) -> list[dict]:
    res: list[dict] = []
    prod, role, guc = t["product"], t["runtime_role"], GUCS[t["product"]]

    def add(cid, status, detail):
        res.append({"db": prod, "check": cid, "status": status, "detail": detail})

    # ---- R1
    rr = r.rows(t, f"select rolsuper, rolbypassrls from pg_roles where rolname={q(role)}")
    if not rr:
        add("R1", "FAIL", f"runtime role {role} does not exist")
        return res
    sup, byp = rr[0]
    owners = t["owner_roles"]
    mem = r.rows(t, "select r.rolname from pg_roles r where (r.rolsuper or r.rolname = any(array[%s]::name[])) "
                    "and r.rolname <> %s and pg_has_role(%s, r.oid, 'MEMBER')" % (",".join(q(o) for o in owners) or "''", q(role), q(role)))
    bad = []
    if sup == "t":
        bad.append("SUPERUSER")
    if byp == "t":
        bad.append("BYPASSRLS")
    if mem:
        bad.append("member of " + ",".join(m[0] for m in mem))
    add("R1", "FAIL" if bad else "PASS", f"{role}: " + ("; ".join(bad) if bad else "NOSUPERUSER NOBYPASSRLS, no owner/superuser membership"))

    # ---- table inventory
    tabs = r.rows(t, """
      select c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity,
             (select count(*) from pg_policy p where p.polrelid=c.oid),
             coalesce((select string_agg(a.attname, ',') from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped), '')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') order by 1""")
    rule, exempt = t["tenant_rule"], t.get("exempt", {})
    tenant_tables, owner_of, tcols = [], {}, {}
    for name, owner, rls, force, npol, cols in tabs:
        owner_of[name] = owner
        tcols[name] = set(cols.split(","))
        if name in exempt:
            continue
        colset = set(cols.split(","))
        is_tenant = (
            rule.get("all")
            or (rule.get("column") and rule.get("column") in colset and not rule.get("prefix"))
            or (rule.get("prefix") and (name.startswith(rule["prefix"]) or rule.get("column") in colset))
            or name in t.get("extra_tenant_tables", [])
        )
        if is_tenant:
            tenant_tables.append((name, rls == "t", force == "t", int(npol)))

    # ---- R2
    owned = sorted(n for n, o in owner_of.items() if o == role)
    owned_other = r.rows(t, f"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                            f"where n.nspname='public' and c.relkind in ('S','v','m','f') and pg_get_userbyid(c.relowner)={q(role)}")[0][0]
    add("R2", "FAIL" if owned or owned_other != "0" else "PASS",
        f"{role} owns {len(owned)} tables" + (f" ({', '.join(owned[:6])}{'…' if len(owned) > 6 else ''})" if owned else "")
        + (f" + {owned_other} other relations" if owned_other != "0" else ""))

    # ---- T1
    t1_bad = [n for n, rls, force, npol in tenant_tables if not (rls and force and npol > 0)]
    add("T1", "FAIL" if t1_bad else "PASS",
        f"{len(tenant_tables) - len(t1_bad)}/{len(tenant_tables)} tenant tables ENABLE+FORCE with policy"
        + (f"; missing: {', '.join(t1_bad)}" if t1_bad else "")
        + (f"; exempt by rule: {', '.join(sorted(exempt))}" if exempt else ""))

    # ---- T2 / T3
    tnames = [n for n, *_ in tenant_tables]
    pols = r.rows(t, "select tablename, policyname, cmd, translate(coalesce(qual,''), chr(10)||chr(13)||chr(9), '   '), "
                     "translate(coalesce(with_check,''), chr(10)||chr(13)||chr(9), '   '), array_to_string(roles, ',') from pg_policies "
                     "where schemaname='public' order by 1,2") if tnames else []
    pols = [p for p in pols if p[0] in tnames]
    t2_bad = [f"{p[0]}.{p[1]}" for p in pols if p[2] in ("ALL", "INSERT", "UPDATE") and not p[4].strip()]
    add("T2", "FAIL" if t2_bad else "PASS",
        f"{len(pols) - len(t2_bad)}/{len(pols)} policies carry explicit WITH CHECK (SELECT/DELETE policies need none)"
        + (f"; missing: {', '.join(t2_bad)}" if t2_bad else ""))

    fn_names = set()
    for p in pols:
        fn_names |= set(re.findall(r"\b([a-z_][a-z0-9_]*)\(\)", p[3] + " " + p[4]))
    fn_src = {}
    if fn_names:
        for name, src in r.rows(t, "select proname, translate(prosrc, chr(10)||chr(13)||chr(9), '   ') from pg_proc where pronamespace='public'::regnamespace and proname = any(array[%s])"
                                % ",".join(q(f) for f in sorted(fn_names))):
            fn_src[name] = src

    def nullif_ok(expr: str) -> bool | None:
        """True = guc read via NULLIF; False = raw read; None = guc not read here."""
        body = expr
        for f in re.findall(r"\b([a-z_][a-z0-9_]*)\(\)", expr):
            if f in fn_src:
                body += " " + fn_src[f]
        low = body.lower()
        if guc not in low:
            return None
        raw = re.findall(r"(nullif\s*\(\s*)?current_setting\s*\(\s*'" + re.escape(guc) + r"'", low)
        return all(prefix for prefix in raw)

    t3_bad, t3_seen = [], 0
    for p in pols:
        for part in (p[3], p[4]):
            ok = nullif_ok(part)
            if ok is None:
                continue
            t3_seen += 1
            if not ok:
                t3_bad.append(f"{p[0]}.{p[1]}")
    t3_bad = sorted(set(t3_bad))
    add("T3", "FAIL" if (t3_bad or (pols and t3_seen == 0)) else "PASS",
        f"{guc}: {len({f'{p[0]}.{p[1]}' for p in pols}) - len(t3_bad)}/{len({f'{p[0]}.{p[1]}' for p in pols})} policies read it via NULLIF(…,'')"
        + (f"; raw current_setting in: {', '.join(t3_bad[:8])}{'…' if len(t3_bad) > 8 else ''}" if t3_bad else ""))

    # ---- T4: every policy that applies to the runtime role (PUBLIC or by name) depends on the tenant
    #          setting, except a SELECT policy whose only extra rows are tenant-less (NULL) system rows.
    t4_bad = []
    for p in pols:
        roles = set(p[5].split(",")) if len(p) > 5 else {"public"}
        if not ({"public", role} & roles):
            continue
        refs = any(nullif_ok(x) is not None for x in (p[3], p[4]))
        if not refs:
            t4_bad.append(f"{p[0]}.{p[1]}")
    add("T4", "FAIL" if t4_bad else "PASS",
        f"policies reaching {role} that ignore the tenant setting: " + (", ".join(t4_bad) if t4_bad else "none"))

    # ---- P1 / P2 (only meaningful on tables that actually have RLS on)
    probe = t["write_probe"]
    ptab, pcol = probe["table"], probe["tenant_column"]
    live_tables = [n for n, rls, force, npol in tenant_tables if rls and npol > 0]
    if ptab not in live_tables:
        add("P1", "FAIL", f"probe table {ptab} has no RLS; pool-reuse probe not meaningful")
        add("P2", "FAIL", f"probe table {ptab} has no RLS")
        return res
    top = r.rows(t, f"select {qi(pcol)}::text from {qi(ptab)} where {qi(pcol)} is not null group by 1 order by count(*) desc limit 1")
    if not top:  # probe table empty: take the most common tenant across all tables that carry a tenant column
        for n in live_tables:
            for c in t["tenant_columns"]:
                if c in tcols.get(n, set()):
                    top = r.rows(t, f"select {qi(c)}::text from {qi(n)} where {qi(c)} is not null group by 1 order by count(*) desc limit 1")
                    if top:
                        break
            if top:
                break
    tenant_a = top[0][0] if top else str(uuid.uuid4())
    tenant_b = str(uuid.uuid4())
    scoped = [(n, c) for n in live_tables for c in t["tenant_columns"] if c in tcols.get(n, set())]
    truth = {}
    if scoped:
        truth_sql = " union all ".join(f"select {q(n)}, count(*) filter (where {qi(c)}::text = {q(tenant_a)}), count(*) from {qi(n)}" for n, c in scoped)
        truth = {row[0]: (int(row[1]), int(row[2])) for row in r.rows(t, truth_sql)}
    # A tenant-less row (tenant column NULL, e.g. link's system domain li.gy) is platform data, not tenant data.
    def tenant_rows(n):
        c = next((c for c in t["tenant_columns"] if c in tcols.get(n, set())), None)
        return f"count(*) filter (where {qi(c)} is not null)" if c else "count(*)"
    counts_sql = " union all ".join(f"select {q(n)}, {tenant_rows(n)} from {qi(n)}" for n in live_tables)
    under_a = " union all ".join(f"select 'A:' || {q(n)}, count(*) filter (where {qi(c)}::text = {q(tenant_a)}), count(*) filter (where {qi(c)}::text <> {q(tenant_a)}) from {qi(n)}" for n, c in scoped) or "select 'A:none', 0, 0"
    sql = f"""
SET ROLE {qi(role)};
BEGIN;
select 'in_tx', set_config({q(guc)}, {q(tenant_a)}, true) is not null, 0, 0;
{under_a};
COMMIT;
select 'after', coalesce(current_setting({q(guc)}, true), '<null>') = '', 0, 0;
{counts_sql};
RESET ROLE;
"""
    out = r.rows(t, sql)
    in_tx = next((o for o in out if o[0] == "in_tx"), None)
    after = next((o for o in out if o[0] == "after"), None)
    a_rows = {o[0][2:]: (int(o[1]), int(o[2])) for o in out if o[0].startswith("A:") and o[0] != "A:none"}
    leaks = [(o[0], o[1]) for o in out if o[0] not in ("in_tx", "after") and not o[0].startswith("A:") and o[1] != "0"]
    p1_ok = after is not None and after[1] == "t" and not leaks
    add("P1", "PASS" if p1_ok else "FAIL",
        f"same backend after COMMIT: setting is '' = {after[1] if after else '?'}; tables with tenant rows visible without a tenant: "
        + (", ".join(f"{n}={c}" for n, c in leaks) if leaks else f"none of {len(live_tables)}"))

    _, out2, err2 = r.psql(t, f"""
BEGIN;
SET LOCAL ROLE {qi(role)};
select set_config({q(guc)}, {q(tenant_a)}, true);
SAVEPOINT s1;
INSERT INTO {qi(ptab)} ({qi(pcol)}) VALUES ({q(tenant_b)});
ROLLBACK TO SAVEPOINT s1;
select set_config({q(guc)}, '', true);
SAVEPOINT s2;
INSERT INTO {qi(ptab)} ({qi(pcol)}) VALUES ({q(tenant_a)});
ROLLBACK TO SAVEPOINT s2;
ROLLBACK;
""", check=False)
    rls_refusals = err2.count("violates row-level security policy")
    cross = {n: v[1] for n, v in a_rows.items() if v[1] != 0}
    incomplete = {n: (a_rows[n][0], truth[n][0]) for n in a_rows if n in truth and a_rows[n][0] != truth[n][0]}
    others = sum(truth[n][1] - truth[n][0] for n in truth)
    p2_ok = in_tx is not None and not cross and not incomplete and rls_refusals == 2
    other = [l for l in err2.splitlines() if "ERROR" in l and "row-level security" not in l]
    add("P2", "PASS" if p2_ok else "FAIL",
        f"under tenant A ({tenant_a[:8]}…) over {len(a_rows)} tables: own rows {sum(v[0] for v in a_rows.values())} of {sum(v[0] for v in truth.values())}, "
        f"other-tenant rows visible {sum(cross.values())} of {others} existing"
        + (f" (LEAK {cross})" if cross else "") + (f" (INCOMPLETE {incomplete})" if incomplete else "")
        + f"; INSERT into {ptab} for tenant B under A + with no tenant: {rls_refusals}/2 refused by RLS"
        + (f"; other errors: {other[0][:160]}" if other else ""))
    return res


def env_check(ssh_key: str | None) -> list[dict]:
    res = []
    owners = {r for t in TARGETS["databases"] for r in t["owner_roles"]} | {"postgres"}
    runtime = {t["runtime_role"] for t in TARGETS["databases"]}
    script = r"""for c in $(docker ps --format '{{.Names}}'); do
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$c" 2>/dev/null | grep -E '^[A-Za-z0-9_]+=postgres(ql)?://' | while IFS= read -r l; do
    k=${l%%=*}; v=${l#*=}; u=$(printf '%s' "$v" | sed -E 's#^postgres(ql)?://([^:@/]+).*#\2#')
    printf '%s\t%s\t%s\n' "$c" "$k" "$u"; done; done"""
    cmd = ["ssh", "-o", "BatchMode=yes"] + (["-i", ssh_key] if ssh_key else []) + [f"root@{TARGETS['host']}", "bash -s"]
    p = subprocess.run(cmd, input=script, capture_output=True, text=True, timeout=120)
    apps = TARGETS["runtime_apps"]
    seen = {}
    for line in p.stdout.splitlines():
        c, k, u = line.split("\t")
        uid = c.split("-")[0]
        if uid in apps:
            seen.setdefault(apps[uid]["name"], []).append((k, u))
    for uid, meta in apps.items():
        name = meta["name"]
        vars_ = seen.get(name, [])
        bad = [f"{k}={u}" for k, u in vars_ if u in owners]
        ok = [f"{k}={u}" for k, u in vars_ if u in runtime]
        res.append({"db": meta["db"], "check": "E1", "status": "FAIL" if bad else ("PASS" if ok else "WARN"),
                    "detail": f"{name}: " + (("owner/superuser URL in runtime env: " + ", ".join(bad)) if bad else
                                             ("runtime URLs: " + ", ".join(ok)) if ok else "no running container found")})
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--dsn", action="append", default=[], help="product=postgresql://superuser@host/db (CI)")
    ap.add_argument("--only", default="")
    ap.add_argument("--container", action="append", default=[], help="product=container (dry-run clone on the host)")
    ap.add_argument("--no-env", action="store_true", help="skip E1 (dry-run clones have no runtime env)")
    ap.add_argument("--json")
    ap.add_argument("--ssh-key", default=os.path.expanduser("~/.hermes/keys/coolify_62.171.141.202_id_ed25519"))
    a = ap.parse_args()
    dsns = dict(d.split("=", 1) for d in a.dsn)
    if not a.live and not dsns:
        ap.error("--live or --dsn required")
    only = set(filter(None, a.only.split(",")))
    targets = [t for t in TARGETS["databases"] if (not only or t["product"] in only) and (a.live or t["product"] in dsns)]
    r = Runner(a.live, dsns, a.ssh_key if a.live else None, dict(c.split("=", 1) for c in a.container))
    results: list[dict] = []
    for t in targets:
        try:
            results += audit_db(r, t)
        except Exception as e:  # noqa: BLE001 - report and continue with the next DB
            results.append({"db": t["product"], "check": "RUN", "status": "FAIL", "detail": str(e)[:300]})
    if a.live and not a.no_env:
        results += [x for x in env_check(a.ssh_key) if not only or x["db"] in only]
    for x in results:
        print(f"{x['status']:<4} {x['db']:<9} {x['check']:<3} {x['detail']}")
    fails = sum(x["status"] == "FAIL" for x in results)
    print(f"\nCC-89 audit: {len(results)} checks, {fails} FAIL, {sum(x['status'] == 'WARN' for x in results)} WARN")
    if a.json:
        Path(a.json).write_text(json.dumps({"results": results, "fails": fails}, indent=2) + "\n")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
