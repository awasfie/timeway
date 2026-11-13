export function getBookerWrapperClasses({ isEmbed }: { isEmbed: boolean }) {
  // We don't want any margins for Embed. Any margin needed should be added by Embed user.
  // WC-TW-6n-4d: plain join, not @calcom/ui/classNames (tailwind-merge): the two class lists never conflict, and
  // this runs on every booking page's first load.
  return isEmbed
    ? "flex h-full items-center justify-center"
    : "flex h-full items-center justify-center min-h-[calc(100dvh)]";
}
