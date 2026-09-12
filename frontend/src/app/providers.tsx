import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Suspense } from 'react'
import { Toaster } from 'sonner'
import { PageLoader } from '@/components/ui/States'
import { ApiError } from '@/lib/api/client'
import { useApplyTheme, useResolvedTheme } from '@/stores/theme'
import { RealtimeProvider } from './RealtimeProvider'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  useApplyTheme()
  const theme = useResolvedTheme()
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RealtimeProvider>
          <Suspense fallback={<PageLoader />}>{children}</Suspense>
        </RealtimeProvider>
        <Toaster
          theme={theme}
          position="top-center"
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
