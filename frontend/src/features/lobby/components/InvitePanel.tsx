import { Check, Copy, QrCode, Share2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { forwardRef, useState } from 'react'
import { toast } from 'sonner'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useResolvedTheme } from '@/stores/theme'
import { cn } from '@/lib/cn'
import { formatINR, formatWhen } from '@/lib/format'
import type { LobbyDetail } from '@/types/api'
import { inviteText } from '../lib'

/** Big code, copy link, QR, WhatsApp + native share. */
export const InvitePanel = forwardRef<HTMLElement, { lobby: LobbyDetail; highlight?: number }>(function InvitePanel({ lobby, highlight }, ref) {
  const desktop = useIsDesktop()
  const theme = useResolvedTheme()
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const text = inviteText(lobby, lobby.invite_url, formatWhen(lobby.start_at), formatINR(lobby.share_paise))
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const showQr = desktop || qrOpen

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lobby.invite_url)
      setCopied(true)
      toast.success('Invite link copied')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Could not copy — long-press the link instead')
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: lobby.title, text, url: lobby.invite_url })
    } catch {
      /* dismissed */
    }
  }

  return (
    <motion.section
      ref={ref}
      id="invite"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="glass relative scroll-mt-24 overflow-hidden rounded-3xl p-5 sm:p-6"
      aria-label="Invite players"
    >
      {!!highlight && (
        <motion.span
          key={highlight}
          aria-hidden
          initial={{ opacity: 1, scale: 0.98 }}
          animate={{ opacity: 0, scale: 1 }}
          transition={{ duration: 1.8, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 z-10 rounded-3xl ring-2 ring-volt"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-volt/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.2em] text-volt uppercase">Invite your squad</div>
            <div className="mt-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Lobby code</div>
            <div className="mt-1 flex font-mono text-3xl font-bold tracking-[0.25em] sm:text-4xl" aria-label={`Lobby code ${lobby.code}`}>
              {lobby.code.split('').map((ch, i) => (
                <motion.span
                  key={i}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 + i * 0.06, type: 'spring', stiffness: 500, damping: 20 }}
                  className="text-gradient-volt"
                >
                  {ch}
                </motion.span>
              ))}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {showQr && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                className={cn(
                  'shrink-0 rounded-2xl p-2.5',
                  theme === 'light'
                    ? 'bg-snow shadow-card ring-1 ring-white/10'
                    : 'bg-fg shadow-[0_0_40px_-10px_color-mix(in_srgb,_var(--color-volt)_60%,_transparent)]',
                )}
              >
                {/* Scanners want dark modules on a light field: paper-white in light, soft chalk in dark. Explicit hex — SVG fill attrs can't take var(). */}
                <QRCodeSVG
                  value={lobby.invite_url}
                  size={desktop ? 104 : 96}
                  bgColor={theme === 'light' ? '#ffffff' : '#eaf2ee'}
                  fgColor={theme === 'light' ? '#0e1a14' : '#05080a'}
                  level="M"
                  marginSize={0}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-xl bg-white/5 p-1.5 pl-3 ring-1 ring-white/10">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{lobby.invite_url.replace(/^https?:\/\//, '')}</span>
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={copy}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors',
              copied ? 'bg-volt text-ink-950' : 'bg-white/10 text-fg hover:bg-white/15',
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? 'y' : 'n'}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                className="flex items-center gap-1.5"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-bold text-ink-950 shadow-[0_10px_30px_-12px_rgb(37_211_102/calc(0.8*var(--glow-strength)))] [[data-theme=light]_&]:text-night transition hover:brightness-110"
          >
            <WhatsAppIcon /> WhatsApp
          </a>
          {canShare ? (
            <button
              type="button"
              onClick={share}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/6 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setQrOpen((v) => !v)}
              disabled={desktop}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/6 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-60"
            >
              <QrCode className="h-4 w-4" /> {desktop ? 'Scan the QR' : qrOpen ? 'Hide QR' : 'Show QR'}
            </button>
          )}
        </div>
        {canShare && !desktop && (
          <button type="button" onClick={() => setQrOpen((v) => !v)} className="mt-3 w-full cursor-pointer text-center text-xs text-muted hover:text-fg">
            {qrOpen ? 'Hide QR code' : 'Show QR code for someone next to you'}
          </button>
        )}
      </div>
    </motion.section>
  )
})

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.5 9.5 0 0 1-4.84-1.32l-.35-.21-3.6.94.96-3.5-.23-.36a9.46 9.46 0 0 1-1.45-5.05c0-5.24 4.27-9.5 9.52-9.5 2.54 0 4.93.99 6.72 2.79a9.43 9.43 0 0 1 2.78 6.72c0 5.24-4.27 9.5-9.5 9.5m8.08-17.58A11.35 11.35 0 0 0 12.05.5C5.76.5.64 5.62.64 11.9c0 2.01.52 3.97 1.52 5.7L.55 23.5l6.04-1.58a11.4 11.4 0 0 0 5.45 1.39h.01c6.29 0 11.41-5.12 11.41-11.4 0-3.05-1.19-5.91-3.34-8.07" />
    </svg>
  )
}
