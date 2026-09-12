/** Client-side password guidance (the server's policy is authoritative — its PASSWORD_POLICY message wins). */

export const MIN_PASSWORD_LENGTH = 12

const COMMON = [
  'password',
  'passw0rd',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'cricket',
  'pytch',
  '123456',
  '12345678',
  'abc123',
  'changeme',
  'kochi',
  'kerala',
]

export interface PasswordRule {
  key: string
  label: string
  ok: boolean
  required: boolean
}

export function passwordRules(pw: string, ctx: { email?: string; name?: string; current?: string; confirm?: string }): PasswordRule[] {
  const lower = pw.toLowerCase()
  const local = (ctx.email ?? '').split('@')[0]?.toLowerCase() ?? ''
  const nameParts = (ctx.name ?? '').toLowerCase().split(/\s+/).filter((p) => p.length >= 3)
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return [
    { key: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: pw.length >= MIN_PASSWORD_LENGTH, required: true },
    { key: 'variety', label: 'Mixes 3+ of: lower, upper, digits, symbols', ok: kinds >= 3, required: true },
    {
      key: 'personal',
      label: 'Doesn’t contain your email or name',
      ok: pw.length > 0 && !(local.length >= 3 && lower.includes(local)) && !nameParts.some((p) => lower.includes(p)),
      required: true,
    },
    { key: 'common', label: 'Not a common or guessable password', ok: pw.length > 0 && !COMMON.some((c) => lower.includes(c)), required: true },
    ...(ctx.current !== undefined
      ? [{ key: 'reuse', label: 'Different from your current password', ok: pw.length > 0 && pw !== ctx.current, required: true }]
      : []),
    ...(ctx.confirm !== undefined ? [{ key: 'match', label: 'Both entries match', ok: pw.length > 0 && pw === ctx.confirm, required: true }] : []),
  ]
}

/** 0..4 */
export function passwordStrength(pw: string): number {
  if (!pw) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  let s = 0
  if (pw.length >= MIN_PASSWORD_LENGTH) s++
  if (pw.length >= 16) s++
  if (kinds >= 3) s++
  if (pw.length >= 20 || (kinds === 4 && pw.length >= 14)) s++
  return s
}

export const newPasswordValid = (value: string, confirm: string, ctx: { email?: string; name?: string; current?: string }) =>
  passwordRules(value, { ...ctx, confirm }).every((r) => r.ok || !r.required)
