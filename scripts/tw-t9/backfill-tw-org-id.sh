#!/usr/bin/env bash
# TW-T9.2c: run the twOrgId backfill. Usage:
#   TW_DATABASE_URL=postgresql://timeway_owner@host/timeway scripts/tw-t9/backfill-tw-org-id.sh --dry-run|--apply [--batch N]
# --dry-run (default): BEGIN; backfill; report; ROLLBACK.
# --apply: COMMIT per batch, then report. Re-running --apply changes 0 rows.
# Prod apply: only from the timeway deploy card, after a verified backup <= 24 h.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mode=dry-run
batch=500
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --apply) mode=apply ;;
    --verify) mode=verify ;;
    --batch) batch="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done
: "${TW_DATABASE_URL:?set TW_DATABASE_URL (timeway_owner)}"
case "$batch" in ''|*[!0-9]*) echo "--batch must be a positive integer" >&2; exit 2 ;; esac
if [ "$mode" = verify ]; then
  exec psql "$TW_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$here/verify-tw-org-id.sql"
fi
exec psql "$TW_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v mode="$mode" -v batch="$batch" -f "$here/backfill-tw-org-id.sql"
