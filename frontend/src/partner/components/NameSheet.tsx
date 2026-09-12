import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage } from '@/lib/api/client'
import { partnerApi } from '../api/endpoints'
import { pk } from '../api/keys'
import { apiFieldErrors } from '../lib/errors'
import { usePartnerAuth } from '../stores/partnerAuth'
import { Field, TextInput } from './kit'

const LATER_KEY = 'pytch-partner-name-later:'

/** Your own display name (the same account as the player app) — shown to teammates and on the audit trail. */
export function NameSheet({ open, onClose, first }: { open: boolean; onClose: () => void; first?: boolean }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={first ? 'What should we call you?' : 'Your name'}
      description={first ? 'Your teammates see it on bookings you log, and it replaces the “Player 1234” placeholder.' : 'Shown to your team and on everything you log.'}
    >
      {open && <NameForm onDone={onClose} onLater={first ? onClose : undefined} />}
    </Sheet>
  )
}

function NameForm({ onDone, onLater }: { onDone: () => void; onLater?: () => void }) {
  const qc = useQueryClient()
  const user = usePartnerAuth((s) => s.user)
  const [name, setName] = useState(user && !user.name_is_default ? user.name : '')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (n: string) => partnerApi.updateMe({ name: n }),
    onSuccess: (me) => {
      usePartnerAuth.getState().setMe(me)
      qc.setQueryData(pk.me, me)
      toast.success(`Thanks, ${me.user.name.split(' ')[0]}`)
      onDone()
    },
    onError: (e) => setError(apiFieldErrors(e).name ?? errorMessage(e)),
  })
  const submit = () => {
    const n = name.trim().replace(/\s+/g, ' ')
    if (n.length < 2) return setError('At least 2 characters, please.')
    if (n.length > 80) return setError('Keep it under 80 characters.')
    if (/^player \d{4}$/i.test(n)) return setError('Use your real name so your team knows it’s you.')
    save.mutate(n)
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field label="Full name" htmlFor="me-name" error={error}>
        <div className="relative">
          <UserRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <TextInput
            id="me-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="e.g. Sneha Kurian"
            autoComplete="name"
            maxLength={80}
            aria-invalid={!!error}
            className="pl-10"
            autoFocus
          />
        </div>
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onLater && (
          <Button type="button" variant="ghost" onClick={onLater}>
            Later
          </Button>
        )}
        <Button type="submit" loading={save.isPending}>
          Save name
        </Button>
      </div>
    </form>
  )
}

/** First visit with the generated "Player 1234" name → ask once per browser session ("Later" snoozes it). */
export function NamePrompt() {
  const user = usePartnerAuth((s) => s.user)
  const [snoozed, setSnoozed] = useState(() => {
    try {
      return !!user && sessionStorage.getItem(LATER_KEY + user.id) === '1'
    } catch {
      return false
    }
  })
  if (!user?.name_is_default) return null
  const later = () => {
    try {
      sessionStorage.setItem(LATER_KEY + user.id, '1')
    } catch {
      /* storage unavailable */
    }
    setSnoozed(true)
  }
  return <NameSheet open={!snoozed} onClose={later} first />
}
