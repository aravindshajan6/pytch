/** GSTIN: 2-digit state code + PAN (5 letters, 4 digits, 1 letter) + entity no. + 'Z' + checksum. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PHONE_RE = /^[6-9]\d{9}$/

/** Normalise an Indian mobile typed in any format to E.164 (+91XXXXXXXXXX) or null. */
export function toE164(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return PHONE_RE.test(d) ? `+91${d}` : null
}
