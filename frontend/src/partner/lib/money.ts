/** Rupee amounts typed by hand (front desks paste "1,200" or fat-finger "1.2.3"). */

/** Keep digits and one decimal point with at most 2 decimals: "1,200" → "1200", "1.2.3" → "1.23", "9.999" → "9.99". */
export function sanitizeRupees(raw: string): string {
  const [int = '', ...rest] = raw.replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${int}.${rest.join('').slice(0, 2)}` : int
}

/** "1200.5" → 120050 paise · '' → 0 · anything unparsable (".") → null. */
export function rupeesToPaise(v: string): number | null {
  const t = v.trim()
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** Validation message for an amount field, or null when fine. `max` in paise (the API caps offline amounts). */
export function moneyError(v: string, { max = 10_000_000, required = false }: { max?: number; required?: boolean } = {}): string | null {
  const paise = rupeesToPaise(v)
  if (paise === null) return 'Enter an amount like 1200 or 1200.50.'
  if (required && paise === 0) return 'Enter the amount.'
  if (paise > max) return `That’s more than ₹${(max / 100).toLocaleString('en-IN')} — check the amount.`
  return null
}

/** Paise → the editable rupee string ("" for 0). */
export const paiseToRupees = (paise: number) => (paise ? String(paise / 100) : '')
