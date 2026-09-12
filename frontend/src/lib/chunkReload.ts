/**
 * Recovery for "the page's JS chunk is gone": a tab opened before a redeploy asks for a hashed chunk
 * that no longer exists (or the network dropped mid-navigation). One reload fetches the new build;
 * a sessionStorage timestamp makes sure we never loop if the reload doesn't help.
 */

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Unable to preload CSS/i

const RELOAD_KEY = 'pytch-chunk-reload-at'
const LOOP_GUARD_MS = 30_000

export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : ''
  return CHUNK_ERROR.test(text)
}

/**
 * Reload once to pick up the current build. Returns false (and does nothing) when offline — a reload
 * would only swap our friendly screen for the browser's — when we already reloaded moments ago, or
 * when sessionStorage is unavailable (no loop guard → no automatic reload).
 */
export function reloadForFreshBuild(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
    if (Date.now() - last < LOOP_GUARD_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
