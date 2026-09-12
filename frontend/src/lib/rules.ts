/**
 * Business-rule numbers the UI needs to phrase copy / gate actions *before* the server says no.
 * Prefer the runtime values from `/meta` (admin-tunable); the constants below are either fallbacks
 * for those or mirror backend settings that `/meta` doesn't expose — keep them in sync by hand.
 * The server stays the authority: these only decide what we offer and how we explain it.
 */
import type { AppMeta } from '@/types/api'

/** Fallback for `/meta.cancel_cutoff_hours` — confirmed matches can't be cancelled this close to kick-off. */
const DEFAULT_CANCEL_CUTOFF_HOURS = 6

/** Fallback for `/meta.dropout_penalty_hours` — leaving a confirmed match this close counts as a dropout. */
const DEFAULT_DROPOUT_PENALTY_HOURS = 24

/** Fallbacks for runtime settings served by /meta. */
const DEFAULT_SOS_WINDOW_HOURS = 6
const DEFAULT_SUB_DISCOUNT_PCT = 20

export const sosWindowHours = (meta: Pick<AppMeta, 'sos_window_hours'> | undefined) => meta?.sos_window_hours ?? DEFAULT_SOS_WINDOW_HOURS
export const subDiscountPct = (meta: Pick<AppMeta, 'sub_discount_pct'> | undefined) => meta?.sub_discount_pct ?? DEFAULT_SUB_DISCOUNT_PCT
export const cancelCutoffHours = (meta: Pick<AppMeta, 'cancel_cutoff_hours'> | undefined) =>
  meta?.cancel_cutoff_hours ?? DEFAULT_CANCEL_CUTOFF_HOURS
export const dropoutPenaltyHours = (meta: Pick<AppMeta, 'dropout_penalty_hours'> | undefined) =>
  meta?.dropout_penalty_hours ?? DEFAULT_DROPOUT_PENALTY_HOURS

const HOUR_MS = 3600 * 1000

/** Hours from now until `iso` (negative once it has passed). */
export const hoursUntil = (iso: string, now = Date.now()) => (new Date(iso).getTime() - now) / HOUR_MS

/** Epoch ms at which `iso` is `hours` away — e.g. when the cancel window closes. */
export const msBefore = (iso: string, hours: number) => new Date(iso).getTime() - hours * HOUR_MS

/**
 * What a bench sub pays for a seat — same rule as `bench.discount_for`: the discounted price rounded *up* to
 * a whole rupee, so the discount never exceeds the advertised %. (The SOS carries the exact server price.)
 */
export const subSharePaise = (sharePaise: number, discountPct: number) =>
  Math.ceil((sharePaise - Math.floor((sharePaise * discountPct) / 100)) / 100) * 100
