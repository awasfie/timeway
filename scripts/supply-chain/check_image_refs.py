#!/usr/bin/env python3
"""WC-PE-7 / CC-93 / D-R74 D2: every container image this repo references comes from ghcr.io/awasfie/* by digest.

Scans Dockerfiles (FROM), compose files (image:) and GitHub workflow files (image:, container/services images).
A reference passes when it is `ghcr.io/awasfie/<name>[:tag]@sha256:<64 hex>`. Anything else (docker.io implicit or
explicit, other registries, tags without a digest) must be listed in the allowlist file with the card that removes it.

The allowlist is a ratchet, not a skip: a NEW non-GHCR reference fails, and an allowlist line whose reference is no
longer in the repo also fails (the list can only shrink, and it shrinks in the same PR that removes the reference).

  python3 scripts/supply-chain/check_image_refs.py            # exit 0 clean, 1 findings
  python3 scripts/supply-chain/check_image_refs.py --list     # print every reference found, no verdict

Allowlist format (ops/supply-chain/image-ref-allowlist.txt), one per line, `#` comments allowed:
  <repo-relative path>|<image reference>   # <card that removes it>
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ALLOWLIST = os.path.join(ROOT, "ops", "supply-chain", "image-ref-allowlist.txt")
GOOD = re.compile(r"^ghcr\.io/awasfie/[a-z0-9._/-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$")
SKIP_DIRS = {"node_modules", ".git", ".turbo", "dist", "coverage", ".lighthouseci", "docs"}
FROM = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?", re.I)
IMAGE = re.compile(r"^\s*(?:-\s*)?image:\s*['\"]?([^'\"\s#]+)")


def is_dockerfile(name):
    return name == "Dockerfile" or name.startswith("Dockerfile.") or name.endswith(".Dockerfile")


def is_compose(name):
    return re.match(r"^(docker-)?compose[^/]*\.ya?ml$", name) is not None


def lines_of(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def scan(root=ROOT):
    """[(relpath, ref)] in a stable order."""
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        rel_d = os.path.relpath(d, root)
        in_workflows = rel_d.replace(os.sep, "/") == ".github/workflows"
        for f in sorted(files):
            path = os.path.join(d, f)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if is_dockerfile(f):
                stages = set()
                for line in lines_of(path):
                    m = FROM.match(line)
                    if not m:
                        continue
                    ref, alias = m.group(1), m.group(2)
                    if ref.lower() != "scratch" and ref not in stages and "$" not in ref:
                        out.append((rel, ref))
                    if alias:
                        stages.add(alias)
            elif is_compose(f) or (in_workflows and f.endswith((".yml", ".yaml"))):
                for line in lines_of(path):
                    m = IMAGE.match(line)
                    if m and "${{" not in m.group(1):
                        out.append((rel, m.group(1)))
    return out


def load_allowlist(path=ALLOWLIST):
    allowed = set()
    if not os.path.exists(path):
        return allowed
    with open(path, encoding="utf-8") as f:
        text = f.read().splitlines()
    for line in text:
        line = line.split("#", 1)[0].strip()
        if line:
            p, _, ref = line.partition("|")
            allowed.add((p.strip(), ref.strip()))
    return allowed


def verdict(refs, allowed):
    """(new findings, stale allowlist lines)."""
    found = set(refs)
    new = sorted(r for r in found if not GOOD.match(r[1]) and r not in allowed)
    stale = sorted(a for a in allowed if a not in found)
    return new, stale


def main(argv):
    refs = scan()
    if "--list" in argv:
        for p, r in refs:
            print(f"{'ok ' if GOOD.match(r) else '-- '}{p}|{r}")
        return 0
    new, stale = verdict(refs, load_allowlist())
    good = sum(1 for _, r in refs if GOOD.match(r))
    print(f"image refs: {len(refs)} found, {good} ghcr.io/awasfie by digest, "
          f"{len(refs) - good - len(new)} allowlisted, {len(new)} new, {len(stale)} stale allowlist lines")
    for p, r in new:
        print(f"FAIL new non-GHCR image reference: {p}|{r} (use ghcr.io/awasfie/mirror/...@sha256:..., CC-93)")
    for p, r in stale:
        print(f"FAIL stale allowlist line (reference gone, delete the line): {p}|{r}")
    return 1 if new or stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
