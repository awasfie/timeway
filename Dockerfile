FROM --platform=$BUILDPLATFORM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS builder

WORKDIR /calcom

## If we want to read any ENV variable from .env file, we need to first accept and pass it as an argument to the Dockerfile
ARG NEXT_PUBLIC_LICENSE_CONSENT
ARG NEXT_PUBLIC_WEBSITE_TERMS_URL
ARG NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL
ARG CALCOM_TELEMETRY_DISABLED
# TW-T9.2e: no DATABASE_DIRECT_URL here. The owner URL is never in the image or the runtime env; migrations run in
# the pre-deploy job (scripts/migrate.sh deploy). Without it @calcom/prisma's build step skips auto-migrations.
ARG DATABASE_URL
ARG NEXTAUTH_SECRET=secret
ARG CALENDSO_ENCRYPTION_KEY=secret
ARG MAX_OLD_SPACE_SIZE=6144
ARG NEXT_PUBLIC_API_V2_URL
ARG CSP_POLICY

## We need these variables as required by Next.js build to create rewrites
ARG NEXT_PUBLIC_SINGLE_ORG_SLUG
ARG ORGANIZATIONS_ENABLED

## TW-T7: read at build time by apps/web/app/api/camv/booking-window (Camv integration)
ARG CAMV_INTERNAL_SECRET

ENV NEXT_PUBLIC_WEBAPP_URL=http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER \
  NEXT_PUBLIC_API_V2_URL=$NEXT_PUBLIC_API_V2_URL \
  NEXT_PUBLIC_LICENSE_CONSENT=$NEXT_PUBLIC_LICENSE_CONSENT \
  NEXT_PUBLIC_WEBSITE_TERMS_URL=$NEXT_PUBLIC_WEBSITE_TERMS_URL \
  NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL=$NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL \
  CALCOM_TELEMETRY_DISABLED=$CALCOM_TELEMETRY_DISABLED \
  DATABASE_URL=$DATABASE_URL \
  NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
  CALENDSO_ENCRYPTION_KEY=${CALENDSO_ENCRYPTION_KEY} \
  NEXT_PUBLIC_SINGLE_ORG_SLUG=$NEXT_PUBLIC_SINGLE_ORG_SLUG \
  ORGANIZATIONS_ENABLED=$ORGANIZATIONS_ENABLED \
  NODE_OPTIONS=--max-old-space-size=${MAX_OLD_SPACE_SIZE} \
  BUILD_STANDALONE=true \
  CAMV_INTERNAL_SECRET=$CAMV_INTERNAL_SECRET \
  CSP_POLICY=$CSP_POLICY

COPY package.json yarn.lock .yarnrc.yml playwright.config.ts turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY apps/web ./apps/web
COPY apps/api/v2 ./apps/api/v2
COPY packages ./packages

RUN yarn config set httpTimeout 1200000
# No `turbo prune` here: its out/ tree was never copied, so it changed nothing in the image, and turbo's berry
# lockfile parser cannot resolve the relative file: tarball @family/webhooks (INT-2), which failed the build.
RUN yarn install
# Build and make embed servable from web/public/embed folder
RUN yarn workspace @calcom/trpc run build
RUN yarn --cwd packages/embeds/embed-core workspace @calcom/embed-core run build
RUN yarn --cwd apps/web workspace @calcom/web run copy-app-store-static
RUN yarn --cwd apps/web workspace @calcom/web run build
RUN rm -rf node_modules/.cache .yarn/cache apps/web/.next/cache

FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS builder-two

WORKDIR /calcom
ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000

ENV NODE_ENV=production

COPY package.json .yarnrc.yml turbo.json i18n.json ./
COPY .yarn ./.yarn
COPY --from=builder /calcom/yarn.lock ./yarn.lock
COPY --from=builder /calcom/node_modules ./node_modules
COPY --from=builder /calcom/packages ./packages
COPY --from=builder /calcom/apps/web ./apps/web
COPY --from=builder /calcom/packages/prisma/schema.prisma ./prisma/schema.prisma
COPY scripts scripts
RUN chmod +x scripts/*

# Save value used during this build stage. If NEXT_PUBLIC_WEBAPP_URL and BUILT_NEXT_PUBLIC_WEBAPP_URL differ at
# run-time, then start.sh will find/replace static values again.
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

RUN scripts/replace-placeholder.sh http://NEXT_PUBLIC_WEBAPP_URL_PLACEHOLDER ${NEXT_PUBLIC_WEBAPP_URL}

# IMGSCAN-A1 (WC-PE-7 step 4, CC-93): the runtime stage is the slim Debian 12 Node base, pinned by digest, so the
# full node:20 image's -dev/headers packages (imagemagick, mariadb, linux-libc-dev) and toolchain never ship.
# `apt-get upgrade` lands perl/gnutls on the security revisions published at build time. npm/npx are removed:
# nothing at runtime calls them (start.sh and migrate.sh use the local node_modules/.bin), and npm's bundled tar
# was a CRITICAL finding. openssl provides libssl3 for the Prisma engines; netcat for wait-for-it; wget for the
# HEALTHCHECK.
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS tzbase

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends netcat-openbsd wget openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# WC-TW-5a (CC-65): one tzdata version for Node/ICU, the OS and Postgres, pinned in ops/tzdata/pin.env. Applied after
# apt so no package upgrade can overwrite it; Debian's zoneinfo is replaced whole so no stale zone survives. The
# build fails here if Node or the OS do not report the pin. CI builds this stage (.github/workflows/tzdata-pin.yml).
COPY ops/tzdata /opt/tzdata/src
RUN sh /opt/tzdata/src/install.sh /opt/tzdata \
  && rm -rf /usr/share/zoneinfo \
  && mv /opt/tzdata/zoneinfo /usr/share/zoneinfo \
  && ln -s . /usr/share/zoneinfo/posix \
  && ln -sf /usr/share/zoneinfo/Etc/UTC /etc/localtime
ENV ICU_TIMEZONE_FILES_DIR=/opt/tzdata/icu
RUN node /opt/tzdata/src/assert.mjs

FROM tzbase AS runner

WORKDIR /calcom

COPY --from=builder-two /calcom ./
# Build-time Go binaries (esbuild via vite/tsx/trigger.dev, depot CLI) are never executed by the app; they carried
# the Go-stdlib/moby CRITICALs that ignore.trivyignore.yaml listed with "prune is the fix".
RUN rm -rf node_modules/@depot node_modules/@esbuild/linux-x64/bin/esbuild \
  node_modules/trigger.dev/node_modules/@esbuild/linux-x64/bin/esbuild
ARG NEXT_PUBLIC_WEBAPP_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL \
  BUILT_NEXT_PUBLIC_WEBAPP_URL=$NEXT_PUBLIC_WEBAPP_URL

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=30s --retries=5 \
  CMD wget --spider http://localhost:3000 || exit 1

CMD ["/calcom/scripts/start.sh"]
