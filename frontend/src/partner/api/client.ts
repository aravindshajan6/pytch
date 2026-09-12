import { API_BASE, buildUrl, createHttpClient, makeTokenRefresher } from '@/lib/api/client'
import type { PartnerAuth } from '@/types/partner'
import { usePartnerAuth } from '../stores/partnerAuth'

export const PARTNER_BASE = `${API_BASE}/partner`

const refreshPartner = makeTokenRefresher(usePartnerAuth, {
  lock: 'pytch-partner-refresh',
  url: buildUrl('/auth/refresh', undefined, PARTNER_BASE),
  onSuccess: (auth) => usePartnerAuth.getState().setSession(auth as PartnerAuth),
  onRejected: () => usePartnerAuth.getState().logout(),
})

/** Partner-audience client: own token source, acting provider header, refresh via /partner/auth/refresh. */
export const partnerHttp = createHttpClient({
  base: PARTNER_BASE,
  getAccessToken: () => usePartnerAuth.getState().accessToken,
  refresh: refreshPartner,
  headers: (): Record<string, string> => {
    const pid = usePartnerAuth.getState().providerId
    return pid ? { 'X-Provider-Id': pid } : {}
  },
})
