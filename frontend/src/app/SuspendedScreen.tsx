import { ShieldAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { formatDateLong, formatTime } from '@/lib/format'
import { realtime } from '@/lib/realtime'
import { useSuspension } from '@/stores/suspension'

/**
 * Full-screen explanation for a suspended / banned player (set by the API client on any
 * `403 ACCOUNT_SUSPENDED`, incl. a rejected token refresh or the OTP login). The session is already
 * cleared at that point; "OK" just dismisses and goes home — no redirect loop through /login.
 */
export function SuspendedScreen() {
  const suspension = useSuspension((s) => s.suspension)
  const clear = useSuspension((s) => s.clear)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const okRef = useRef<HTMLButtonElement>(null)
  const show = !!suspension && !pathname.startsWith('/partner') // the partner portal has its own session

  useEffect(() => {
    if (!show) return
    realtime.disconnect()
    okRef.current?.focus()
  }, [show])

  const banned = suspension?.message.toLowerCase().includes('banned')
  const until = suspension?.until ? new Date(suspension.until) : null

  return (
    <AnimatePresence>
      {show && suspension && (
        <motion.div
          role="alertdialog"
          aria-modal
          aria-labelledby="suspended-title"
          aria-describedby="suspended-body"
          className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-ink-950/85 px-5 py-10 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="glass-strong relative w-full max-w-md overflow-hidden rounded-3xl p-6 text-center shadow-card sm:p-8"
          >
            <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-flare/20 blur-3xl" />
            <div className="relative">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-flare/12 text-flare ring-1 ring-flare/30">
                <ShieldAlert className="h-8 w-8" />
              </div>
              <h1 id="suspended-title" className="mt-5 text-2xl font-bold">
                {banned ? 'This account has been banned' : 'Your account is suspended'}
              </h1>
              <div id="suspended-body" className="mt-3 space-y-3 text-sm text-muted">
                {suspension.reason && (
                  <p className="rounded-2xl bg-white/4 px-4 py-3 text-left ring-1 ring-white/8">
                    <span className="block text-[11px] font-semibold tracking-wider text-subtle uppercase">Reason</span>
                    <span className="text-fg/90">{suspension.reason}</span>
                  </p>
                )}
                {banned ? (
                  <p>You can't book, join or play on PYTCH with this account.</p>
                ) : until ? (
                  <p>
                    You can play again after <b className="text-fg">{formatDateLong(until)}, {formatTime(until)}</b>. Until then you can't book, join or pay.
                  </p>
                ) : (
                  <p>You can't book, join or play until the suspension is lifted.</p>
                )}
                <p className="text-xs text-subtle">Think this is a mistake? Contact PYTCH support and quote the phone number on this account.</p>
              </div>
              <Button
                ref={okRef}
                block
                size="lg"
                className="mt-6"
                onClick={() => {
                  clear()
                  navigate('/', { replace: true })
                }}
              >
                OK
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
