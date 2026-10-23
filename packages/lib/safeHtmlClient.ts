import DOMPurify from "dompurify";

/**
 * Client-side re-sanitising of HTML the server already produced with `markdownToSafeHTML`
 * (booking-field labels, event descriptions). Keeps markdown-it and sanitize-html out of the
 * booking page bundle (WC-TW-6c-4); only DOMPurify, which the booker already loads, is used here.
 */
export function sanitizeSafeHtmlClient(html: string | null | undefined): string {
  if (!html) return "";
  // DOMPurify needs a DOM. During SSR the string comes straight from markdownToSafeHTML on the
  // same server, so it is already sanitised; the browser re-sanitises on hydration.
  if (!DOMPurify.isSupported) return html;
  return DOMPurify.sanitize(html);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Appends plain text (e.g. a formatted price) inside the last paragraph of server-sanitised label
 * HTML, matching what markdownToSafeHTML(`${label}${text}`) produced before.
 */
export function appendTextToSafeHtml(html: string, text: string): string {
  const escaped = escapeHtml(text);
  const match = html.match(/<\/p>\s*$/);
  if (!match || match.index === undefined) return `${html}${escaped}`;
  return `${html.slice(0, match.index)}${escaped}${html.slice(match.index)}`;
}
