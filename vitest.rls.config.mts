import { defineConfig } from "vitest/config";

// TW-T9.2a: real-Postgres RLS specs, run only by the CI `rls` job (never in the unit run).
export default defineConfig({
  test: {
    include: ["packages/prisma/**/*.rls-test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
