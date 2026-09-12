import { Check, Circle, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { passwordRules, passwordStrength } from '../lib/password'
import { Field, TextInput } from './ui'

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <TextInput {...props} type={show ? 'text' : 'password'} className={cn('pr-10', props.className)} spellCheck={false} autoCapitalize="off" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-subtle hover:text-fg"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent']
const STRENGTH_COLOR = ['bg-flare', 'bg-flare', 'bg-sun', 'bg-mint', 'bg-volt']

/** New-password + confirm with live policy checklist. Reports validity upward. */
export function NewPasswordFields({
  value,
  confirm,
  onChange,
  onConfirmChange,
  email,
  name,
  current,
}: {
  value: string
  confirm: string
  onChange: (v: string) => void
  onConfirmChange: (v: string) => void
  email?: string
  name?: string
  current?: string
}) {
  const rules = passwordRules(value, { email, name, current, confirm })
  const strength = passwordStrength(value)
  return (
    <div className="space-y-4">
      <Field label="New password" htmlFor="new-password">
        <PasswordInput id="new-password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} required />
      </Field>
      <div>
        <div className="flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i < strength ? STRENGTH_COLOR[strength] : 'bg-white/8')} />
          ))}
        </div>
        <div className="mt-1 text-[11px] text-muted" aria-live="polite">
          Strength: <span className="text-fg">{value ? STRENGTH[strength] : '—'}</span>
        </div>
      </div>
      <Field label="Confirm new password" htmlFor="confirm-password">
        <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirmChange(e.target.value)} required />
      </Field>
      <ul className="grid gap-1.5 text-xs" aria-label="Password requirements">
        {rules.map((r) => (
          <li key={r.key} className={cn('flex items-center gap-2 transition-colors', r.ok ? 'text-mint' : 'text-muted')}>
            {r.ok ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Circle className="h-3 w-3 opacity-60" />}
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

