import {
  AppWindow,
  CalendarSync,
  CodeXml,
  Footprints,
  Phone,
  Smartphone,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { BlockSource, OfflinePaymentMode } from '@/types/partner'

export type AnySource = BlockSource | 'pytch'

export interface SourceMeta {
  label: string
  /** 2–3 letter tag shown inside narrow calendar cells (identity is never colour-only). */
  short: string
  icon: LucideIcon
  /** CSS colour (theme-aware custom property from partner.css). */
  color: string
  group: ChannelGroup
  hint: string
}

export type ChannelGroup = 'pytch' | 'walk_in' | 'phone' | 'apps' | 'synced' | 'blocked'

export const SOURCES: Record<AnySource, SourceMeta> = {
  pytch: { label: 'Pytch online', short: 'PY', icon: Zap, color: 'var(--src-pytch)', group: 'pytch', hint: 'Booked & paid in the Pytch app' },
  walk_in: { label: 'Walk-in', short: 'WI', icon: Footprints, color: 'var(--src-walk_in)', group: 'walk_in', hint: 'Customer at the front desk' },
  phone: { label: 'Phone / WhatsApp', short: 'PH', icon: Phone, color: 'var(--src-phone)', group: 'phone', hint: 'Booked over a call or chat' },
  playo: { label: 'Playo', short: 'PL', icon: Smartphone, color: 'var(--src-playo)', group: 'apps', hint: 'Mirrored from the Playo partner app' },
  hudle: { label: 'Hudle', short: 'HU', icon: Smartphone, color: 'var(--src-hudle)', group: 'apps', hint: 'Mirrored from the Hudle partner app' },
  khelomore: { label: 'KheloMore', short: 'KM', icon: Smartphone, color: 'var(--src-khelomore)', group: 'apps', hint: 'Mirrored from KheloMore' },
  other_app: { label: 'Other app', short: 'OA', icon: AppWindow, color: 'var(--src-other_app)', group: 'apps', hint: 'Any other booking app' },
  ical: { label: 'Imported calendar', short: 'iC', icon: CalendarSync, color: 'var(--src-ical)', group: 'synced', hint: 'Synced from an iCal feed' },
  api: { label: 'Channel API', short: 'API', icon: CodeXml, color: 'var(--src-api)', group: 'synced', hint: 'Pushed by connected software' },
  maintenance: { label: 'Maintenance', short: 'MT', icon: Wrench, color: 'var(--src-maintenance)', group: 'blocked', hint: 'Closed — no bookings' },
}

/** Sources a human can pick in the quick-block sheet (iCal/API rows are created by sync only). */
export const MANUAL_SOURCES: BlockSource[] = ['walk_in', 'phone', 'playo', 'hudle', 'khelomore', 'other_app', 'maintenance']
export const OTHER_APPS: BlockSource[] = ['playo', 'hudle', 'khelomore', 'other_app']

/** Folded channel groups for charts (≤ 6 slots, fixed order = validated palette order). */
export const CHANNEL_GROUPS: { key: ChannelGroup; label: string; color: string }[] = [
  { key: 'pytch', label: 'Pytch', color: '--viz-1' },
  { key: 'walk_in', label: 'Walk-in', color: '--viz-2' },
  { key: 'phone', label: 'Phone', color: '--viz-3' },
  { key: 'apps', label: 'Other apps', color: '--viz-4' },
  { key: 'synced', label: 'iCal / API', color: '--viz-5' },
  { key: 'blocked', label: 'Maintenance', color: '--viz-6' },
]

export const PAYMENT_MODES: { value: OfflinePaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'online_other', label: 'Paid online' },
  { value: 'unpaid', label: 'Unpaid' },
]

export const paymentModeLabel = (m: OfflinePaymentMode | null | undefined) =>
  PAYMENT_MODES.find((p) => p.value === m)?.label ?? '—'

export const sourceMeta = (s: string): SourceMeta => SOURCES[s as AnySource] ?? SOURCES.other_app
