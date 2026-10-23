Visit https://cal.com/docs/introduction/quick-start/self-hosting/installation#requirements for full instructions

## Timeway production: migrations run before the app, never inside it (TW-T9.2e, CC-89)

The runtime container holds one database URL: `DATABASE_URL` = `timeway_app` (NOSUPERUSER, NOBYPASSRLS, owns no
table). The DDL role `timeway_owner` is used only by a one-shot migrate job that runs before each app deploy.

### Env names

| Name | Where | Role |
|---|---|---|
| `DATABASE_URL` | Coolify env of `timeway-web` (runtime) | `timeway_app` |
| `TIMEWAY_MIGRATE_DATABASE_URL` | Infisical only (read by the deploy tool for the job) | `timeway_owner` |
| `DATABASE_DIRECT_URL` | **remove** from `timeway-web` (prod and preview) | was `timeway_owner` |

The image carries no database URL (the Dockerfile no longer sets `DATABASE_DIRECT_URL`; step 1 of
`.github/workflows/docker-migrate-job.yml` asserts it). Values live in Infisical / Coolify env, never in the repo.

### Pre-deploy order

1. Backup verified <= 24 h (live-data floor).
2. Migrate job, with an image built from the commit Coolify is about to deploy. The URL goes over stdin into
   `--env-file`, never into argv or a file on the host:

   ```sh
   printf 'TIMEWAY_MIGRATE_DATABASE_URL=%s\n' "$URL" \
     | docker run --rm -i --network coolify --env-file /dev/stdin <timeway image> /calcom/scripts/migrate.sh deploy
   ```

   Output ends with `[migrate] result exit=N`; any URL in Prisma's output is printed as `<url>`. Exit != 0 means
   **no app deploy**.
3. App deploy (`timeway-web`). `scripts/start.sh` runs `scripts/migrate.sh status` as `timeway_app` before serving:
   with a pending or failed migration it exits 1, so the new container never turns healthy and the old one keeps
   serving. `seed-app-store.ts` stays in start.sh: it only upserts `App` rows and sets `Credential.appId`, which
   `timeway_app` is granted (once RLS is on for `Credential`, that update reaches no row outside an org context,
   which is harmless).
4. Health: `GET /auth/login` 200/307; `scripts/migrate.sh status` inside the container exits 0.

`scripts/migrate.sh status` is the schema health mode (read-only; uses `TIMEWAY_MIGRATE_DATABASE_URL` if set, else
`DATABASE_URL`).

### Transition (the next timeway deploy card)

Deploy the commit that carries this change with the migrate job first (step 2), then remove `DATABASE_DIRECT_URL`
from the `timeway-web` Coolify env (prod and preview) and redeploy; the CC-89 E1 check then reads PASS.
Rollback: put `DATABASE_DIRECT_URL` back and redeploy the previous image (its start.sh migrates itself and needs it).
