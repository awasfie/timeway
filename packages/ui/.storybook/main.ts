// WC-DX-14c1 (Q-11): Storybook 9 for @calcom/ui, same shape as salesos packages/ui/.storybook (WC-DX-5).
// a11y runs in fail mode (preview.tsx) and @storybook/addon-vitest runs every story + axe in Chromium.
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    cfg.plugins = [...(cfg.plugins ?? []), tailwindcss()];
    // A mid-run optimizer reload makes Vitest drop the browser runner, so pre-bundle React up front.
    cfg.optimizeDeps = {
      ...cfg.optimizeDeps,
      include: [
        ...(cfg.optimizeDeps?.include ?? []),
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      // The monorepo root carries the npm "crypto" deprecate-holder package (no entry file), which shadows the
      // Node builtin that storybook/internal/common imports; keep it external so the optimizer does not resolve it.
      esbuildOptions: {
        ...cfg.optimizeDeps?.esbuildOptions,
        plugins: [
          ...(cfg.optimizeDeps?.esbuildOptions?.plugins ?? []),
          {
            name: "node-builtin-crypto",
            setup(build) {
              build.onResolve({ filter: /^crypto$/ }, () => ({ path: "crypto", external: true }));
            },
          },
        ],
      },
    };
    return cfg;
  },
};
export default config;
