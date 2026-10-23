/**
 * Request header the proxy sets with the request pathname, so the root layout
 * (which Next.js does not give the pathname) can pick <html lang/dir> for
 * booking pages whose event type pins an interfaceLanguage (TW-AWS-3).
 * Kept dependency-free so the proxy bundle does not pull in Prisma.
 */
export const PATHNAME_HEADER = "x-tw-pathname";
