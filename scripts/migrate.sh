#!/bin/sh
# TW-T9.2e (WC-PE-6 timeway, CC-89 "no owner URL in any runtime env").
#
# Schema migrations run as a one-shot job BEFORE the app deploy, never in the runtime container.
# The DDL role's URL (timeway_owner) is TIMEWAY_MIGRATE_DATABASE_URL; it is given to this job only
# (Infisical / the deploy tool), never to the app's Coolify env. The app keeps DATABASE_URL = timeway_app.
#
#   scripts/migrate.sh deploy   prisma migrate deploy as the owner, then exit (job exit != 0 -> NO app deploy)
#   scripts/migrate.sh status   prisma migrate status, read-only; exit 0 = schema up to date, 1 = pending/failed.
#                               Uses TIMEWAY_MIGRATE_DATABASE_URL if set, else DATABASE_URL (timeway_app can read
#                               _prisma_migrations). start.sh runs it as the app role before serving.
#
# One-shot job with the app image (URL over stdin, never in argv):
#   printf 'TIMEWAY_MIGRATE_DATABASE_URL=%s\n' "$URL" | docker run --rm -i --network coolify \
#     --env-file /dev/stdin <timeway image> /calcom/scripts/migrate.sh deploy
#
# The URL is exported only into the prisma child process as DATABASE_URL and DATABASE_DIRECT_URL (schema.prisma
# reads both). Nothing here prints a URL; Prisma's own output is filtered for postgres:// strings.
set -eu

mode="${1:-}"
schema="${TIMEWAY_PRISMA_SCHEMA:-/calcom/packages/prisma/schema.prisma}"

redact() { sed -E 's#postgres(ql)?://[^[:space:]"]+#<url>#g'; }

run_prisma() {
  # $1 = URL, rest = prisma args. pipefail is not POSIX: keep Prisma's exit code via a status file.
  url="$1"; shift
  rcfile="$(mktemp)"
  { DATABASE_URL="$url" DATABASE_DIRECT_URL="$url" npx prisma "$@" --schema "$schema" 2>&1; echo $? >"$rcfile"; } | redact
  rc="$(cat "$rcfile")"; rm -f "$rcfile"
  return "$rc"
}

case "$mode" in
  deploy)
    if [ -z "${TIMEWAY_MIGRATE_DATABASE_URL:-}" ]; then
      echo "[migrate] FATAL: TIMEWAY_MIGRATE_DATABASE_URL is not set (the DDL role; job env only, never the app env)" >&2
      exit 2
    fi
    echo "[migrate] deploy: prisma migrate deploy as TIMEWAY_MIGRATE_DATABASE_URL"
    rc=0; run_prisma "$TIMEWAY_MIGRATE_DATABASE_URL" migrate deploy || rc=$?
    echo "[migrate] result exit=$rc"
    exit "$rc"
    ;;
  status)
    if [ -n "${TIMEWAY_MIGRATE_DATABASE_URL:-}" ]; then
      var=TIMEWAY_MIGRATE_DATABASE_URL; url="$TIMEWAY_MIGRATE_DATABASE_URL"
    elif [ -n "${DATABASE_URL:-}" ]; then
      var=DATABASE_URL; url="$DATABASE_URL"
    else
      echo "[migrate] FATAL: neither TIMEWAY_MIGRATE_DATABASE_URL nor DATABASE_URL is set" >&2
      exit 2
    fi
    echo "[migrate] status: prisma migrate status as $var"
    rc=0; run_prisma "$url" migrate status || rc=$?
    echo "[migrate] result exit=$rc"
    exit "$rc"
    ;;
  *)
    echo "usage: scripts/migrate.sh deploy|status" >&2
    exit 2
    ;;
esac
