#!/usr/bin/env bash
# TW-T13: usage  TW_DATABASE_URL=postgresql://timeway_owner@host/timeway \
#   scripts/tw-t13/migrate-pilot-bookings.sh --dry-run|--apply MAP.csv
# MAP.csv: header "username,org_slug". Prod --apply only from the deploy card after a verified backup <= 24 h.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mode=dry-run
case "${1:-}" in --dry-run) mode=dry-run ;; --apply) mode=apply ;; *) echo "usage: $0 --dry-run|--apply MAP.csv" >&2; exit 2 ;; esac
map="${2:?MAP.csv required}"
[ -r "$map" ] || { echo "cannot read $map" >&2; exit 2; }
: "${TW_DATABASE_URL:?set TW_DATABASE_URL (timeway_owner)}"
exec psql "$TW_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v mode="$mode" -f "$here/migrate-pilot-bookings.sql" < "$map"
