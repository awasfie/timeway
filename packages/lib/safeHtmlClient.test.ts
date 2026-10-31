// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownToSafeHTML } from "./markdownToSafeHTML";
import { appendTextToSafeHtml, sanitizeSafeHtmlClient } from "./safeHtmlClient";

describe("booking-field label rendered on the server, sanitised again on the client", () => {
  const label = "I accept the [terms](https://timeway.co/terms) **now**<img src=x onerror=alert(1)><script>alert(2)</script>";

  it("server markdownToSafeHTML strips script and event handlers", () => {
    const html = markdownToSafeHTML(label);
    expect(html).toContain("<a target='_blank' class='text-blue-500 hover:text-blue-600' href=\"https://timeway.co/terms\"");
    expect(html).toContain("<strong>now</strong>");
    expect(html).not.toMatch(/<script|onerror|<img/i);
  });

  it("client DOMPurify pass keeps the server output and blocks injected markup", () => {
    const html = markdownToSafeHTML(label);
    const client = sanitizeSafeHtmlClient(html);
    expect(client).toContain("<strong>now</strong>");
    expect(client).toContain('href="https://timeway.co/terms"');
    expect(sanitizeSafeHtmlClient(`${html}<img src=x onerror=alert(1)><script>alert(2)</script>`)).not.toMatch(
      /<script|onerror/i
    );
    expect(sanitizeSafeHtmlClient(null)).toBe("");
  });

  it("price suffix is appended as escaped text inside the label paragraph", () => {
    const html = markdownToSafeHTML("Add **parking**");
    expect(appendTextToSafeHtml(html, " (AED 10.00)")).toBe("<p>Add <strong>parking</strong> (AED 10.00)</p>\n");
    expect(appendTextToSafeHtml(html, " <b>x</b>")).toBe("<p>Add <strong>parking</strong> &lt;b&gt;x&lt;/b&gt;</p>\n");
    expect(appendTextToSafeHtml("plain", " (1)")).toBe("plain (1)");
  });

  it("matches the old client output for a priced checkbox label", () => {
    const before = markdownToSafeHTML("Add **parking** (AED 10.00)");
    const after = appendTextToSafeHtml(markdownToSafeHTML("Add **parking**"), " (AED 10.00)");
    expect(after).toBe(before);
  });
});
