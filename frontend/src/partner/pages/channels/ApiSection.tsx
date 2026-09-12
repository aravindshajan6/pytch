import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { errorMessage } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { formatDateLong, pluralize, timeAgo } from '@/lib/format'
import type { ApiKeyOut, WebhookEvent, WebhookOut } from '@/types/partner'
import { partnerApi } from '../../api/endpoints'
import { pk } from '../../api/keys'
import { ChoiceChips, ConfirmSheet, Field, Panel, SecretOnceSheet, StatusPill, TextInput } from '../../components/kit'
import { copyText } from '../../lib/copy'

const SCOPES: { value: ApiKeyOut['scopes'][number]; label: string; hint: string }[] = [
  { value: 'availability:read', label: 'Read availability', hint: 'List pitches and free/busy times' },
  { value: 'blocks:write', label: 'Create & cancel blocks', hint: 'Push bookings from your software' },
]
const EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: 'slot.booked', label: 'Slot booked' },
  { value: 'slot.released', label: 'Slot released' },
  { value: 'slot.blocked', label: 'Slot blocked' },
  { value: 'block.cancelled', label: 'Block cancelled' },
]

export function ApiSection({ keys, webhooks, baseUrl, owner }: { keys: ApiKeyOut[]; webhooks: WebhookOut[]; baseUrl: string; owner: boolean }) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: pk.channels })
  const [newKey, setNewKey] = useState(false)
  const [newHook, setNewHook] = useState(false)
  const [secret, setSecret] = useState<{ title: string; value: string; text: string } | null>(null)
  const [revoking, setRevoking] = useState<ApiKeyOut | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const revokedCount = keys.filter((k) => k.revoked_at).length
  const shownKeys = showRevoked ? keys : keys.filter((k) => !k.revoked_at)
  const [deleting, setDeleting] = useState<WebhookOut | null>(null)

  const revoke = useMutation({
    mutationFn: (id: string) => partnerApi.channels.revokeApiKey(id),
    onSuccess: () => {
      invalidate()
      setRevoking(null)
      toast.success('Key revoked', { description: 'Requests using it are rejected from now on.' })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => partnerApi.channels.deleteWebhook(id),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
      toast.success('Webhook removed')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const test = useMutation({
    mutationFn: (id: string) => partnerApi.channels.testWebhook(id),
    onSuccess: (r) => {
      invalidate()
      if (r.ok) toast.success('Test delivered', { description: `Your endpoint answered ${r.status_code}.` })
      else toast.error('Test failed', { description: r.status_code ? `Your endpoint answered ${r.status_code}.` : 'No response — check the URL is reachable over https.' })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Panel
      id="api"
      title="API & webhooks"
      subtitle="For venue software that can talk to Pytch directly — bookings sync in seconds instead of minutes."
    >
      {!owner && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-white/[0.03] p-3 text-xs text-muted ring-1 ring-white/8">
          <Lock className="h-3.5 w-3.5" /> Only the account owner can create keys and webhooks.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2 [&>div]:min-w-0">
        {/* keys */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-sans text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-volt" /> API keys
            </h3>
            {owner && (
              <Button size="sm" variant="secondary" onClick={() => setNewKey(true)}>
                <Plus className="h-3.5 w-3.5" /> New key
              </Button>
            )}
          </div>
          {shownKeys.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/12 p-5 text-center text-xs text-muted">{revokedCount ? 'No active keys.' : 'No keys yet.'}</p>
          ) : (
            <ul className="space-y-2">
              {shownKeys.map((k) => (
                <li key={k.id} className={cn('rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/8', k.revoked_at && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{k.name}</div>
                      <div className="font-mono text-xs text-muted">{k.prefix}••••••••</div>
                    </div>
                    {k.revoked_at ? (
                      <StatusPill status="revoked" />
                    ) : (
                      owner && (
                        <Button size="sm" variant="ghost" className="hover:text-flare" onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      )
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg/75">
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">
                    Created {formatDateLong(k.created_at)} · {k.last_used_at ? `last used ${timeAgo(k.last_used_at)}` : 'never used'}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {revokedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowRevoked((v) => !v)}
              aria-expanded={showRevoked}
              className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-muted hover:text-fg"
            >
              {showRevoked ? 'Hide revoked keys' : `Show ${pluralize(revokedCount, 'revoked key')}`}
            </button>
          )}
        </div>

        {/* webhooks */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-sans text-sm font-semibold">
              <Webhook className="h-4 w-4 text-volt" /> Webhooks
            </h3>
            {owner && (
              <Button size="sm" variant="secondary" onClick={() => setNewHook(true)}>
                <Plus className="h-3.5 w-3.5" /> Add endpoint
              </Button>
            )}
          </div>
          {webhooks.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/12 p-5 text-center text-xs text-muted">No endpoints yet.</p>
          ) : (
            <ul className="space-y-2">
              {webhooks.map((w) => (
                <li key={w.id} className="rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/8">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 truncate font-mono text-xs">{w.url}</div>
                    {!w.is_active ? (
                      <StatusPill status="paused" />
                    ) : w.consecutive_failures > 0 ? (
                      <StatusPill status="error" label={`${w.consecutive_failures} failed`} />
                    ) : (
                      <StatusPill status="ok" />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {w.events.map((e) => (
                      <span key={e} className="rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg/75">
                        {e}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">
                      {w.last_delivery_at ? `Last delivery ${timeAgo(w.last_delivery_at)} · HTTP ${w.last_status_code ?? '—'}` : 'No deliveries yet'}
                    </span>
                    {owner && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => test.mutate(w.id)} loading={test.isPending && test.variables === w.id}>
                          <Send className="h-3.5 w-3.5" /> Test
                        </Button>
                        <Button size="sm" variant="ghost" className="hover:text-flare" onClick={() => setDeleting(w)} aria-label="Remove webhook">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Docs baseUrl={baseUrl} />

      <NewKeySheet
        open={newKey}
        onClose={() => setNewKey(false)}
        onCreated={(key) => {
          invalidate()
          setNewKey(false)
          setSecret({ title: 'Your new API key', value: key, text: 'This is the only time you’ll see the full key. Store it in your software’s settings or a password manager.' })
        }}
      />
      <NewWebhookSheet
        open={newHook}
        onClose={() => setNewHook(false)}
        onCreated={(s) => {
          invalidate()
          setNewHook(false)
          setSecret({ title: 'Webhook signing secret', value: s, text: 'Use this secret to verify the X-Pytch-Signature header on every delivery. It’s shown only once.' })
        }}
      />
      <SecretOnceSheet key={secret?.value} open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''} secret={secret?.value ?? null} description={secret?.text} />
      <ConfirmSheet
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke “${revoking?.name}”?`}
        description="Any software using this key loses access immediately. This can’t be undone."
        confirmLabel="Revoke key"
        danger
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
      <ConfirmSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Remove this webhook?"
        description="Pytch stops sending events to this URL."
        confirmLabel="Remove"
        danger
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Panel>
  )
}

function NewKeySheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyOut['scopes']>(['availability:read'])
  const create = useMutation({
    mutationFn: () => partnerApi.channels.createApiKey(name.trim(), scopes),
    onSuccess: (r) => {
      setName('')
      onCreated(r.key)
    },
    onError: (e) => toast.error('Couldn’t create key', { description: errorMessage(e) }),
  })
  return (
    <Sheet open={open} onClose={onClose} title="New API key" description="Give each system its own key so you can revoke one without breaking the others." size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field label="Name" htmlFor="ak-n">
          <TextInput id="ak-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front-desk POS" required />
        </Field>
        <Field label="Permissions">
          <div className="space-y-2">
            {SCOPES.map((s) => (
              <label key={s.value} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[var(--color-volt)]"
                  checked={scopes.includes(s.value)}
                  onChange={() => setScopes((l) => (l.includes(s.value) ? l.filter((x) => x !== s.value) : [...l, s.value]))}
                />
                <span>
                  <span className="block font-mono text-sm">{s.value}</span>
                  <span className="block text-xs text-muted">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
        <Button type="submit" block size="lg" loading={create.isPending} disabled={!name.trim() || scopes.length === 0}>
          Create key
        </Button>
      </form>
    </Sheet>
  )
}

function NewWebhookSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (secret: string) => void }) {
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>(EVENTS.map((e) => e.value))
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => partnerApi.channels.createWebhook(url.trim(), events),
    onSuccess: (r) => {
      setUrl('')
      onCreated(r.secret)
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = () => {
    try {
      if (new URL(url.trim()).protocol !== 'https:') throw new Error()
    } catch {
      return setError('Webhook URLs must start with https://')
    }
    create.mutate()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add a webhook endpoint" description="Pytch POSTs a signed JSON event whenever a slot changes." size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Endpoint URL" htmlFor="wh-u" error={error} hint="Must be public and https.">
          <TextInput
            id="wh-u"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            placeholder="https://pos.myturf.in/hooks/pytch"
            className="font-mono text-sm"
            inputMode="url"
          />
        </Field>
        <Field label="Events">
          <ChoiceChips
            size="sm"
            options={EVENTS.map((e) => ({ value: e.value, label: e.label }))}
            value={events}
            onChange={(v) => setEvents((l) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]))}
          />
        </Field>
        <Button type="submit" block size="lg" loading={create.isPending} disabled={!url.trim() || events.length === 0}>
          Add endpoint
        </Button>
      </form>
    </Sheet>
  )
}

const SNIPPETS = {
  node: `import crypto from 'node:crypto'

// Express: app.post('/hooks/pytch', express.raw({ type: 'application/json' }), handler)
export function verifyPytch(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const t = Number(parts.t)
  if (Math.abs(Date.now() / 1000 - t) > 300) return false // 5-min replay window
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ''))
}`,
  python: `import hmac, hashlib, time

def verify_pytch(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts["t"])
    if abs(time.time() - t) > 300:  # 5-min replay window
        return False
    msg = f"{t}.".encode() + raw_body
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`,
}

function Docs({ baseUrl }: { baseUrl: string }) {
  const [lang, setLang] = useState<'node' | 'python' | 'curl'>('node')
  const curl = `curl -H "Authorization: Bearer pk_live_…" \\
  "${baseUrl}/availability?pitch_id=<pitch-id>&date=2026-09-14"

curl -X POST -H "Authorization: Bearer pk_live_…" \\
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d '{"pitch_id":"<pitch-id>","start_at":"2026-09-14T19:00:00+05:30","end_at":"2026-09-14T20:00:00+05:30","external_ref":"POS-1042"}' \\
  "${baseUrl}/blocks"`
  const code = lang === 'curl' ? curl : SNIPPETS[lang]
  return (
    <div className="mt-6 rounded-2xl bg-white/[0.02] p-4 ring-1 ring-white/8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-sans text-sm font-semibold">Developer quick-start</h3>
          <p className="text-xs text-muted">
            Base URL <span className="font-mono text-fg">{baseUrl}</span> · 120 requests/min per key · writes take an <span className="font-mono">Idempotency-Key</span>
          </p>
        </div>
        <Segmented
          size="sm"
          className="pp-seg max-w-full [&_button]:whitespace-nowrap"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'node', label: 'Verify · Node' },
            { value: 'python', label: 'Verify · Python' },
            { value: 'curl', label: 'API · curl' },
          ]}
        />
      </div>
      <div data-theme="dark" className="relative mt-3 overflow-hidden rounded-xl bg-night ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => copyText(code, 'Snippet copied')}
          className="absolute top-2 right-2 cursor-pointer rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-fg hover:bg-white/15"
        >
          Copy
        </button>
        <pre className="overflow-x-auto p-4 pr-16 font-mono text-[12px] leading-relaxed text-fg/90">
          <code>{code}</code>
        </pre>
      </div>
      <p className="mt-3 text-xs text-muted">
        Every delivery carries <span className="font-mono text-fg">X-Pytch-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</span> — an HMAC-SHA256 of <span className="font-mono">"t.body"</span> with your
        signing secret. Reject anything older than 5 minutes, de-duplicate on the event <span className="font-mono">id</span>, reply 2xx fast, and re-fetch availability before acting. Failed
        deliveries retry with exponential back-off.
      </p>
    </div>
  )
}

