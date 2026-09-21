/* eslint-disable playwright/missing-playwright-await */
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { WEBSITE_URL } from "@calcom/lib/constants";

import Credits from "./Credits";

vi.mock("@calcom/lib/constants", async () => {
  const actual = (await vi.importActual("@calcom/lib/constants")) as typeof import("@calcom/lib/constants");
  return {
    ...actual,
    CALCOM_VERSION: "mockedVersion",
  };
});

describe("Tests for Credits component", () => {
  test("Should render credits section with links", () => {
    render(<Credits />);

    const creditsLinkElement = screen.getByRole("link", { name: /Timeway, Inc\./i });
    expect(creditsLinkElement).toBeInTheDocument();
    expect(creditsLinkElement).toHaveAttribute("href", WEBSITE_URL);

    const versionElement = screen.getByText(/mockedVersion/i);
    expect(versionElement).toBeInTheDocument();
  });

  test("Should render credits section with correct text", () => {
    render(<Credits />);

    const currentYear = new Date().getFullYear();
    const copyrightElement = screen.getByText((_, element) =>
      element?.tagName.toLowerCase() === "small" && element.textContent?.includes(`${currentYear}`)
    );
    expect(copyrightElement).toHaveTextContent(`${currentYear}`);
  });
});
