/**
 * Open-redirect guard for `?next=` / `state.from` / notification links: only same-origin in-app paths.
 * Rejects `//host`, `/\host`, absolute URLs, backslashes and control characters (browsers strip tabs and
 * newlines, so `/<tab>/evil.com` would otherwise become `//evil.com`).
 */
export function isSafeInAppPath(url: unknown): url is string {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url) && !/[\\\p{Cc}]/u.test(url)
}

/** `url` when it's a safe in-app path under `prefix` (and not under any `exclude`), else `fallback`. */
export function safeInAppPath(
  url: string | null | undefined,
  fallback: string,
  { prefix = '/', exclude = [] }: { prefix?: string; exclude?: string[] } = {},
): string {
  if (!isSafeInAppPath(url) || !url.startsWith(prefix) || exclude.some((p) => url.startsWith(p))) return fallback
  return url
}
