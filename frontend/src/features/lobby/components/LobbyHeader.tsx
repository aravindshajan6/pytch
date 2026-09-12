import { ArrowLeft, CalendarDays, Check, Copy, Home, Lock, MapPin, Sun, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Chip } from '@/components/ui/Chip'
import { SportBadge } from '@/components/ui/PlayerBits'
import { TurfArt } from '@/components/ui/TurfArt'
import { formatSlotRange, formatWhen } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'
import { STATUS_META, firstName } from '../lib'

export function LobbyHeader({ lobby }: { lobby: LobbyDetail }) {
  const navigate = useNavigate()
  const status = STATUS_META[lobby.status]
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(lobby.booking.code)
      setCopied(true)
      toast.success('Booking code copied')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <header>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app/matches'))}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-sm text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Title card over the turf photo → dark island in both themes. */}
      <motion.div
        data-theme="dark"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl ring-1 ring-white/8"
      >
        <TurfArt seed={lobby.turf.id} sport={lobby.sport} src={lobby.turf.cover_url} className="absolute inset-0 opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900/95 via-ink-900/75 to-ink-900/30" />
        <div className="relative p-4 sm:p-7">
          <div className="flex flex-wrap items-center gap-1.5">
            <SportBadge sport={lobby.sport} format={lobby.format} className="bg-ink-900/60" />
            <Chip tone={status.tone} dot={status.live}>
              {status.label}
            </Chip>
            <Chip tone={lobby.mode === 'split' ? 'sun' : 'electric'}>{lobby.mode === 'split' ? 'Split pay' : 'Host-fronted'}</Chip>
            {lobby.visibility === 'private' && (
              <Chip>
                <Lock className="h-3 w-3" /> Private
              </Chip>
            )}
            {lobby.recorded && (
              <Chip tone="grape">
                <Video className="h-3 w-3" /> Recorded
              </Chip>
            )}
          </div>

          <h1 className="mt-2.5 text-2xl leading-tight font-bold sm:mt-3 sm:text-4xl">{lobby.title}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg/80 sm:mt-3 sm:gap-y-2 sm:text-sm">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-volt" />
              {formatWhen(lobby.start_at)}
              <span className="hidden text-muted sm:inline">({formatSlotRange(lobby.start_at, lobby.end_at)})</span>
            </span>
            <Link to={`/app/turfs/${lobby.turf.slug}`} className="flex items-center gap-1.5 transition hover:text-volt">
              <MapPin className="h-4 w-4 text-volt" />
              <span className="underline decoration-white/20 underline-offset-4">{lobby.turf.name}</span>
              <span className="text-muted">· {lobby.turf.area}</span>
            </Link>
            <span className="flex items-center gap-1.5 text-muted">
              {lobby.pitch.is_indoor ? <Home className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {lobby.pitch.name} · {lobby.pitch.is_indoor ? 'Indoor' : 'Outdoor'}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:mt-4 sm:gap-3">
            <Link to={`/app/players/${lobby.host.id}`} className="flex items-center gap-2 rounded-full pr-3 transition hover:bg-white/5">
              <Avatar user={lobby.host} size="sm" />
              <span className="text-sm">
                <span className="text-muted">Hosted by </span>
                <span className="font-semibold">{firstName(lobby.host)}</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={copyCode}
              aria-label={`Copy booking code ${lobby.booking.code}`}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-ink-900/60 px-3 font-mono text-xs tracking-wider ring-1 ring-white/10 transition hover:ring-volt/50"
            >
              <span className="text-subtle">BOOKING</span> {lobby.booking.code}
              {copied ? <Check className="h-3.5 w-3.5 text-volt" /> : <Copy className="h-3.5 w-3.5 text-muted" />}
            </button>
          </div>
        </div>
      </motion.div>
    </header>
  )
}
