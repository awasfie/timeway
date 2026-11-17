import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/lib/constants", () => ({
  WEBAPP_URL: "https://timeway.co",
  WEBSITE_URL: "https://timeway.co",
  CONSOLE_URL: "https://console.timeway.co",
  EMBED_LIB_URL: "https://timeway.co/embed",
}));

import { resolveLoginCallbackUrl } from "./loginCallbackUrl";

describe("resolveLoginCallbackUrl (timeway sign-in loop)", () => {
  it("no callback -> /event-types, never /", () => {
    expect(resolveLoginCallbackUrl("")).toBe("https://timeway.co/event-types");
    expect(resolveLoginCallbackUrl(null)).toBe("https://timeway.co/event-types");
    expect(resolveLoginCallbackUrl(undefined)).toBe("https://timeway.co/event-types");
  });
  it("bare / and /ar (relative or absolute) -> /event-types", () => {
    for (const c of [
      "/",
      "https://timeway.co",
      "https://timeway.co/",
      "/ar",
      "/ar/",
      "https://timeway.co/ar/",
    ])
      expect(resolveLoginCallbackUrl(c)).toBe("https://timeway.co/event-types");
  });
  it("a deeper callback is kept", () => {
    expect(resolveLoginCallbackUrl("/bookings/upcoming")).toBe("https://timeway.co/bookings/upcoming");
    expect(resolveLoginCallbackUrl("https://timeway.co/settings/my-account/profile")).toBe(
      "https://timeway.co/settings/my-account/profile"
    );
  });
  it("an off-site callback is not followed (open-redirect guard), lands on /event-types", () => {
    expect(resolveLoginCallbackUrl("https://evil.example/x")).toBe("https://timeway.co/event-types");
  });
});
