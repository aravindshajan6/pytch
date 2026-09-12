import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { getLogoutTarget, useAuth } from '@/stores/auth'
import { safeInAppPath } from '@/lib/safePath'

/**
 * Requires a session; bounces to /login?next=… otherwise (or wherever an intentional logout is heading —
 * see `setLogoutTarget`). Sends new users to onboarding.
 */
export function RequireAuth({ allowUnonboarded = false }: { allowUnonboarded?: boolean }) {
  const token = useAuth((s) => s.accessToken)
  const user = useAuth((s) => s.user)
  const location = useLocation()
  if (!token)
    return <Navigate to={getLogoutTarget() ?? `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!allowUnonboarded && user && !user.onboarded)
    return <Navigate to={`/onboarding?next=${encodeURIComponent(location.pathname)}`} replace />
  return <Outlet />
}

/** Logged-in users skip the login page (honouring a safe, same-origin `?next=` target). */
export function RedirectIfAuthed() {
  const token = useAuth((s) => s.accessToken)
  const [params] = useSearchParams()
  const next = params.get('next')
  const target = safeInAppPath(next, '/app')
  return token ? <Navigate to={target} replace /> : <Outlet />
}
