/**
 * Step-up (re-enter TOTP) coordination. Any request answered with STEP_UP_REQUIRED calls
 * `requestStepUp()`; concurrent callers share one prompt. The modal (StepUpModal) resolves or
 * rejects the shared promise; the interceptor then retries the original request exactly once.
 */
import { create } from 'zustand'
import { stepUpCancelled } from './errors'

interface StepUpState {
  open: boolean
  /** When the current elevated window ends (ms epoch) — shown as a chip in the top bar. */
  elevatedUntil: number | null
  resolve: (() => void) | null
  reject: ((e: unknown) => void) | null
}

export const useStepUp = create<StepUpState>()(() => ({ open: false, elevatedUntil: null, resolve: null, reject: null }))

let pending: Promise<void> | null = null

export function requestStepUp(): Promise<void> {
  pending ??= new Promise<void>((resolve, reject) => {
    useStepUp.setState({ open: true, resolve, reject })
  }).finally(() => {
    pending = null
    useStepUp.setState({ open: false, resolve: null, reject: null })
  })
  return pending
}

export function stepUpSucceeded(validUntilIso: string | null) {
  const until = validUntilIso ? Date.parse(validUntilIso) : Date.now() + 5 * 60_000
  useStepUp.setState({ elevatedUntil: Number.isNaN(until) ? Date.now() + 5 * 60_000 : until })
  useStepUp.getState().resolve?.()
}

export function cancelStepUp() {
  useStepUp.getState().reject?.(stepUpCancelled())
}

/** Drop elevation + reject any open prompt (logout). */
export function resetStepUp() {
  useStepUp.getState().reject?.(stepUpCancelled())
  useStepUp.setState({ elevatedUntil: null })
}
