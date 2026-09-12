import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { PartnerRole } from '@/types/partner'
import { partnerApi } from './api/endpoints'
import { pk } from './api/keys'
import { useResetPartnerCache } from './hooks'
import { clearApplyDrafts } from './lib/drafts'
import { usePartnerAuth } from './stores/partnerAuth'

export const RANK: Record<PartnerRole, number> = { staff: 1, manager: 2, owner: 3 }
export const ROLE_LABEL: Record<PartnerRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Front desk' }

export function useLogout() {
  const navigate = useNavigate()
  const reset = useResetPartnerCache()
  return async () => {
    await partnerApi.auth.logout().catch(() => undefined)
    clearApplyDrafts() // the next person on this device must not see this account's half-filled application
    usePartnerAuth.getState().logout(true)
    reset()
    navigate('/partner/login', { replace: true })
  }
}

/**
 * Keep memberships (role, venue scope, provider status) fresh in an open session: on window focus, every minute,
 * and whenever the API answers 403 — a role the owner just changed shows up without a reload.
 */
export function useProviderStatusWatch() {
  const qc = useQueryClient()
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        if (e.type !== 'updated' || e.action.type !== 'error') return
        const err = e.action.error as { code?: string; status?: number } | null
        const stale = err?.code === 'PROVIDER_NOT_APPROVED' || err?.code === 'PROVIDER_REQUIRED' || err?.status === 403
        if (stale && e.query.queryKey[1] !== 'me') qc.invalidateQueries({ queryKey: pk.me })
      }),
    [qc],
  )
  useEffect(
    () =>
      qc.getMutationCache().subscribe((e) => {
        const err = e.mutation?.state.error as { status?: number } | null | undefined
        if (e.type === 'updated' && e.action.type === 'error' && err?.status === 403) qc.invalidateQueries({ queryKey: pk.me })
      }),
    [qc],
  )
}
