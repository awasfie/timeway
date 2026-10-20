import { defineConfig } from "vitest/config";

// Standalone config for `yarn workspace @calcom/conformance test`; the root suite also picks these files up.
export default defineConfig({
  test: {
    name: "@calcom/conformance",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
