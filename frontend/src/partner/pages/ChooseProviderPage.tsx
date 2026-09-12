import { LogOut, PlusCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, Navigate } from 'react-router'
import { Logo } from '@/components/layout/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AuthBackdrop } from '@/features/auth/AuthBackdrop'
import { ProviderList } from '../components/PartnerShell'
import { useLogout } from '../session'
import { usePartnerAuth } from '../stores/partnerAuth'

/** Picker for users who belong to several venue businesses. */
export default function ChooseProviderPage() {
  const memberships = usePartnerAuth((s) => s.memberships)
  const user = usePartnerAuth((s) => s.user)
  const logout = useLogout()
  if (memberships.length === 0) return <Navigate to="/partner/apply" replace />
  return (
    <div className="relative flex min-h-dvh flex-col">
      <AuthBackdrop />
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-4">
        <Logo to="/" />
        <div className="flex items-center gap-2">
          <ThemeToggle className="h-9 w-9 rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]" />
          <button type="button" onClick={logout} aria-label="Log out" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/8 hover:text-flare">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-16">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-[11px] font-bold tracking-[0.2em] text-volt uppercase">Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Which venue business?</h1>
          <p className="mt-2 text-sm text-muted">You’re part of {memberships.length} venue accounts. You can switch any time from the sidebar.</p>
          <div className="mt-6">
            <ProviderList />
          </div>
          <Link to="/partner/apply" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-sm font-semibold text-muted transition hover:border-volt/50 hover:text-volt">
            <PlusCircle className="h-4 w-4" /> List another venue business
          </Link>
        </motion.div>
      </main>
    </div>
  )
}
