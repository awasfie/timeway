# WC-TW-4b (S8): the timeway-soak runner. Build context = packages/conformance (Coolify base directory).
# No GHCR node mirror exists yet, so both stages use the digest-pinned base the timeway Dockerfile already runs on
# (CC-93 allowlist, swap with t_969dbe7f). No Docker Hub login is needed for a public digest pull.
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS build
WORKDIR /build
COPY package.json tsconfig.json ./
COPY src ./src
# Node 20 cannot strip TypeScript types, so the runner ships as two self-contained ESM bundles (no runtime deps, S7).
RUN npm install --no-save --no-audit --no-fund esbuild@0.25.12 \
  && npx esbuild src/run.ts src/report.ts --bundle --platform=node --target=node20 --format=esm \
       --outdir=dist --out-extension:.js=.mjs

FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
ENV NODE_ENV=production SOAK_DIR=/data/soak
WORKDIR /app
COPY --from=build /build/dist ./dist
RUN mkdir -p /data/soak && chown -R node:node /data/soak /app
USER node
VOLUME /data/soak
ENTRYPOINT ["node", "dist/run.mjs"]
CMD ["run"]
