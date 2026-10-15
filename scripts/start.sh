#!/bin/sh
set -x

# Replace the statically built BUILT_NEXT_PUBLIC_WEBAPP_URL with run-time NEXT_PUBLIC_WEBAPP_URL
# NOTE: if these values are the same, this will be skipped.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"

scripts/wait-for-it.sh ${DATABASE_HOST} -- echo "database is up"

# TW-T9.2e (CC-89): migrations run in the pre-deploy job (scripts/migrate.sh deploy, owner URL), never here.
# The runtime holds only DATABASE_URL = timeway_app. Refuse to serve on a schema with pending or failed
# migrations, so the old container keeps serving if the job did not run.
if ! scripts/migrate.sh status; then
  echo "[start] FATAL: schema is not up to date; run the pre-deploy migrate job (deploy/README.md)" >&2
  exit 1
fi

npx ts-node --transpile-only /calcom/scripts/seed-app-store.ts
yarn start
