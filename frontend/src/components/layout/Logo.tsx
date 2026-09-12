import { Link } from 'react-router'
import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0b1210" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#c8ff2e" strokeWidth="5" />
      <path d="M32 6v52" stroke="#c8ff2e" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4" fill="#c8ff2e" />
    </svg>
  )
}

export function Logo({ to = '/', className, wordmarkClassName }: { to?: string; className?: string; wordmarkClassName?: string }) {
  return (
    <Link to={to} className={cn('group inline-flex items-center gap-2.5', className)} aria-label="PYTCH home">
      <LogoMark className="transition-transform duration-500 group-hover:rotate-90" />
      <span className={cn('font-display text-xl font-bold tracking-tight', wordmarkClassName)}>
        PYT<span className="text-volt">C</span>H
      </span>
    </Link>
  )
}
