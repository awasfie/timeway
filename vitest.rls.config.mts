import path from "node:path";
import { defineConfig } from "vitest/config";

// TW-T9.2a: real-Postgres RLS specs, run only by the CI `rls` job (never in the unit run).
// TW-T9.2b5: the e2e smoke under apps/web imports route handlers, so it needs the
// apps/web path aliases the unit config carries.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@calcom/web/public/app-store/svg-hashes.json",
        replacement: path.resolve(__dirname, "vitest-mocks/svg-hashes.json"),
      },
      { find: "@lib", replacement: path.resolve(__dirname, "apps/web/lib") },
      { find: /^app\//, replacement: `${path.resolve(__dirname, "apps/web/app")}/` },
      { find: "@calcom/web", replacement: path.resolve(__dirname, "apps/web") },
    ],
  },
  test: {
    include: ["packages/prisma/**/*.rls-test.ts", "apps/web/test/tw-rls/**/*.rls-test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: { deps: { inline: [/@calcom\/.*/] } },
  },
});
