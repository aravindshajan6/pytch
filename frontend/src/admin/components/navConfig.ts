import {
  Activity,
  CalendarCheck,
  CreditCard,
  LayoutDashboard,
  Landmark,
  MapPin,
  Megaphone,
  ScrollText,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Stamp,
  Store,
  TicketPercent,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { AdminPermission } from '@/types/admin'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Hidden unless the operator's role has this permission. */
  perm?: AdminPermission
  end?: boolean
  badge?: 'approvals'
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/approvals', label: 'Approvals', icon: Stamp, perm: 'approvals.decide', badge: 'approvals' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/players', label: 'Players', icon: Users, perm: 'users.view' },
      { to: '/providers', label: 'Providers', icon: Store, perm: 'providers.view' },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { to: '/venues', label: 'Venues', icon: MapPin, perm: 'venues.view' },
      { to: '/bookings', label: 'Bookings', icon: CalendarCheck, perm: 'bookings.view' },
      { to: '/catalog', label: 'Sports catalog', icon: Shapes, perm: 'catalog.manage' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/payments', label: 'Payments', icon: CreditCard, perm: 'payments.view' },
      { to: '/settlements', label: 'Settlements', icon: Landmark, perm: 'payouts.view' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { to: '/coupons', label: 'Coupons', icon: TicketPercent, perm: 'coupons.view' },
      { to: '/broadcasts', label: 'Broadcasts', icon: Megaphone, perm: 'broadcast.send' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/settings', label: 'Settings', icon: SlidersHorizontal, perm: 'settings.view' },
      { to: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.view' },
      { to: '/team', label: 'Admin team', icon: ShieldCheck, perm: 'admins.manage' },
      { to: '/system', label: 'System health', icon: Activity },
    ],
  },
]
