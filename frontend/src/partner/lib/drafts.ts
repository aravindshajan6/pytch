/**
 * The partner application wizard keeps its draft on this device — per account, so a shared front-desk tablet never
 * shows one person's half-filled application (bank details included) to the next login.
 */
const PREFIX = 'pytch-partner-apply-draft'

export const applyDraftKey = (userId: string | null | undefined) => `${PREFIX}:${userId ?? 'anon'}`

/** Drop every application draft on this device (explicit logout) — including the old device-wide key. */
export function clearApplyDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch {
    /* storage unavailable */
  }
}
