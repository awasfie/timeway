#!/usr/bin/env bash
# TW-T9 (t_9824b7a7): give org-less, teamless users a personal org. Usage:
#   TW_DATABASE_URL=postgresql://timeway_owner@host/timeway scripts/tw-t9/provision-orgless-users.sh --dry-run|--apply
# Run after backfill-tw-org-id.sh. --dry-run (default) rolls back; --apply commits; re-running --apply provisions 0.
# Prod apply: only from the timeway deploy card, after a verified backup <= 24 h.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mode=dry-run
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --apply) mode=apply ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done
: "${TW_DATABASE_URL:?set TW_DATABASE_URL (timeway_owner)}"
exec psql "$TW_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v mode="$mode" -f "$here/provision-orgless-users.sql"
