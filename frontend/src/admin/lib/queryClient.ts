import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/lib/api/http'
import { isSilentError } from './errors'

/** Admin query cache — lives in memory only and is wiped on logout / idle timeout. */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Background refetch failures of already-rendered data surface as a toast; first loads show inline.
      if (query.state.data !== undefined && !isSilentError(err)) toast.error(errorMessage(err))
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => {
      if (mutation.meta?.silent || isSilentError(err)) return
      toast.error(errorMessage(err))
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
})

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean }
  }
}
