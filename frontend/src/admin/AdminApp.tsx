import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { useApplyTheme, useResolvedTheme } from '@/stores/theme'
import { StepUpModal } from './components/Dialogs'
import { adminApi } from './lib/api'
import { onChannel } from './lib/channel'
import { logout, refreshSession } from './lib/http'
import { queryClient } from './lib/queryClient'
import { useSession } from './lib/session'
import { AppRouter } from './routes'

let booted: Promise<void> | null = null

/** Restore the session from the httpOnly refresh cookie (the access token never survives a reload). */
function boot() {
  booted ??= (async () => {
    adminApi
      .meta()
      .then((m) => useSession.setState({ demo: !!m.demo_mode }))
      .catch(() => {})
    const auth = await refreshSession()
    if (!auth) useSession.setState({ status: 'anon' })
  })()
  return booted
}

export function AdminApp() {
  useApplyTheme()
  const theme = useResolvedTheme()

  useEffect(() => {
    void boot()
    return onChannel((m) => {
      const status = useSession.getState().status
      if (m.type === 'logout' && status !== 'anon') void logout('You signed out in another tab.', { broadcast: false, server: false })
      if (m.type === 'login' && status === 'anon') void refreshSession()
    })
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <AppRouter />
        <StepUpModal />
        <Toaster
          theme={theme}
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: 'var(--glass-strong-from)',
              border: '1px solid var(--glass-strong-border)',
              boxShadow: 'var(--shadow-card)',
              backdropFilter: 'blur(16px)',
              color: 'var(--color-fg)',
            },
          }}
        />
      </MotionConfig>
    </QueryClientProvider>
  )
}
