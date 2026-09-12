import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Loader2, Megaphone, Send, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { LogoMark } from '@/components/layout/Logo'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { PageHeader } from '@/components/ui/States'
import { SPORTS, SPORT_LIST } from '@/lib/sports'
import type { BroadcastSegment } from '@/types/admin'
import type { Sport } from '@/types/api'
import { When } from '../components/bits'
import { DataTable } from '../components/DataTable'
import { ConfirmDialog } from '../components/Dialogs'
import { ChipToggle, Field, Panel, Select, TextArea, TextInput } from '../components/ui'
import { errorMessage } from '@/lib/api/http'
import { adminApi, qk } from '../lib/api'
import { fieldErrors, isSilentError } from '../lib/errors'
import { useDebounced } from '../lib/hooks'

/** In-app paths only — mirrors platform/schemas.py `broadcast_url_problem` (no `//`, `..` or backslashes). */
const BROADCAST_URL_RE = /^\/(app|partner)(\/[A-Za-z0-9_-]+)*\/?(\?[^\s#]*)?$/

function urlProblem(url: string): string | null {
  if (!url) return null
  if (url.includes('//') || url.includes('..') || url.includes('\\')) return 'The link can’t contain “//”, “..” or backslashes'
  if (!BROADCAST_URL_RE.test(url)) return 'Use an in-app path like /app/discover or /partner/bookings (letters, digits, - and _)'
  return null
}

const players = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'player' : 'players'}`

export default function Broadcasts() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [areas, setAreas] = useState<string[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [activeDays, setActiveDays] = useState<string>('')
  const [confirm, setConfirm] = useState(false)

  const meta = useQuery({ queryKey: qk.meta, queryFn: adminApi.meta, staleTime: Infinity })
  // empty dimensions are omitted (= no restriction)
  const segment: BroadcastSegment = {
    ...(areas.length ? { areas } : {}),
    ...(sports.length ? { sports } : {}),
    ...(activeDays ? { active_days: Number(activeDays) } : {}),
  }
  const segKey = useDebounced(JSON.stringify(segment), 350)
  const preview = useQuery({
    queryKey: ['admin', 'broadcasts', 'preview', segKey],
    queryFn: () => adminApi.broadcasts.preview(JSON.parse(segKey) as BroadcastSegment),
    staleTime: 30_000,
  })
  const history = useQuery({ queryKey: ['admin', 'broadcasts', 'list'], queryFn: adminApi.broadcasts.list })

  const [serverUrlError, setServerUrlError] = useState<string | null>(null)
  const urlError = urlProblem(url) ?? serverUrlError
  const urlValid = !urlError
  const valid = title.trim().length >= 2 && body.trim().length >= 2 && urlValid
  const recipients = preview.data?.recipients

  const send = useMutation({
    mutationFn: () => adminApi.broadcasts.send({ title: title.trim(), body: body.trim(), url: url || null, segment }),
    meta: { silent: true },
    onError: (e) => {
      // 422 → put the server's message on the field it belongs to
      const fields = fieldErrors(e)
      if (fields.url) {
        setServerUrlError(fields.url.replace(/^Value error, /, ''))
        setConfirm(false)
        return
      }
      if (!isSilentError(e)) toast.error(errorMessage(e))
    },
    onSuccess: (res) => {
      const n = res?.recipient_count ?? recipients
      toast.success(n == null ? 'Broadcast sent' : `Sent to ${players(n)}`)
      qc.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
      setConfirm(false)
      setTitle('')
      setBody('')
      setUrl('')
    },
  })

  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Growth" title="Broadcasts" subtitle="In-app + push announcements to a segment of players. Use sparingly — every send is audited." />
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <Panel title="Compose">
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid) setConfirm(true)
            }}
          >
            <Field label="Title" required hint={`${title.length}/120`}>
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Monsoon nights are back" />
            </Field>
            <Field label="Message" required hint={`${body.length}/300`}>
              <TextArea value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} placeholder="Covered courts in Kakkanad are 20% off after 8 PM this week." />
            </Field>
            <Field label="Open in app (optional)" hint="An in-app path, e.g. /app/discover or /app/wallet — external links aren’t allowed." error={urlError ?? undefined}>
              <TextInput
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value.trim())
                  setServerUrlError(null)
                }}
                placeholder="/app/discover"
                className="font-mono"
                spellCheck={false}
                invalid={!!urlError}
              />
            </Field>

            <div className="space-y-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Audience</div>
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-volt/10 px-2.5 py-1 text-xs text-volt ring-1 ring-volt/25" aria-live="polite">
                  {preview.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  <span className="num font-semibold">{recipients == null ? '—' : recipients.toLocaleString('en-IN')}</span> recipients
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs text-muted">Areas {areas.length === 0 && <span className="text-subtle">(everywhere)</span>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(meta.data?.areas ?? []).map((a) => (
                    <ChipToggle key={a.name} active={areas.includes(a.name)} onClick={() => toggle(areas, a.name, setAreas)}>
                      {a.name}
                    </ChipToggle>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs text-muted">Plays {sports.length === 0 && <span className="text-subtle">(any sport)</span>}</div>
                <div className="flex flex-wrap gap-1.5">
                  {SPORT_LIST.map((s) => (
                    <ChipToggle key={s} active={sports.includes(s)} onClick={() => toggle(sports, s, setSports)}>
                      {SPORTS[s].emoji} {SPORTS[s].label}
                    </ChipToggle>
                  ))}
                </div>
              </div>
              <Field label="Activity">
                <Select value={activeDays} onChange={(e) => setActiveDays(e.target.value)} className="w-full sm:w-64">
                  <option value="">Everyone, regardless of activity</option>
                  <option value="7">Active in the last 7 days</option>
                  <option value="14">Active in the last 14 days</option>
                  <option value="30">Active in the last 30 days</option>
                  <option value="90">Active in the last 90 days</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!valid || !recipients}>
                <Send className="h-4 w-4" /> Review & send
              </Button>
            </div>
          </form>
        </Panel>

        <div className="space-y-5">
          <Panel title="Preview" description="How it lands on a phone">
            <div className="rounded-[1.6rem] bg-night p-3 ring-1 ring-white/10" data-theme="dark">
              <div className="rounded-2xl bg-white/8 p-3 backdrop-blur">
                <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted">
                  <LogoMark className="h-4 w-4" /> PYTCH · now
                  <Bell className="ml-auto h-3 w-3" />
                </div>
                <div className="text-sm font-semibold text-fg">{title || 'Your title'}</div>
                <div className="mt-0.5 text-xs leading-snug text-fg/75">{body || 'Your message appears here.'}</div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel flush title="History">
        <DataTable
          rows={history.data}
          loading={history.isLoading}
          rowKey={(b) => b.id}
          maxHeight="max-h-[480px]"
          empty={<span className="inline-flex items-center gap-2"><Megaphone className="h-4 w-4" /> No broadcasts sent yet.</span>}
          columns={[
            {
              key: 't',
              header: 'Message',
              cell: (b) => (
                <div className="min-w-0 max-w-md">
                  <div className="truncate font-medium">{b.title}</div>
                  <div className="truncate text-xs text-muted">{b.body}</div>
                </div>
              ),
            },
            {
              key: 'seg',
              header: 'Segment',
              cell: (b) => (
                <div className="flex max-w-64 flex-wrap gap-1">
                  {b.segment.areas?.map((a) => (
                    <Chip key={a} size="xs">
                      {a}
                    </Chip>
                  ))}
                  {b.segment.sports?.map((s) => (
                    <Chip key={s} size="xs">
                      {SPORTS[s as Sport]?.emoji ?? s}
                    </Chip>
                  ))}
                  {b.segment.active_days && <Chip size="xs">≤{b.segment.active_days}d</Chip>}
                  {!b.segment.areas?.length && !b.segment.sports?.length && !b.segment.active_days && <span className="text-xs text-subtle">Everyone</span>}
                </div>
              ),
              hideBelow: 'md',
            },
            { key: 'n', header: 'Recipients', align: 'right', cell: (b) => <span className="num">{b.recipient_count.toLocaleString('en-IN')}</span> },
            { key: 'by', header: 'Sent by', cell: (b) => <span className="text-xs text-muted">{b.created_by ?? '—'}</span>, hideBelow: 'lg' },
            { key: 'w', header: 'When', cell: (b) => <When iso={b.created_at} className="text-xs text-muted" /> },
          ]}
        />
      </Panel>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={recipients == null ? 'Send this broadcast?' : `Send to ${players(recipients)}?`}
        description="Notifications can’t be recalled once sent."
        tone="primary"
        confirmLabel="Send broadcast"
        loading={send.isPending}
        onConfirm={() => send.mutate()}
      >
        <div className="rounded-xl bg-white/4 p-3 text-sm ring-1 ring-white/8">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 text-fg/75">{body}</div>
        </div>
      </ConfirmDialog>
    </div>
  )
}
