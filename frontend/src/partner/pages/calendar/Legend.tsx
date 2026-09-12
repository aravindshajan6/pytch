import { AlertTriangle, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { alpha } from '@/lib/color'
import { SOURCES, type AnySource } from '../../lib/sources'

const ORDER: AnySource[] = ['pytch', 'walk_in', 'phone', 'playo', 'hudle', 'khelomore', 'other_app', 'ical', 'api', 'maintenance']

/** Colour key for the calendar — every swatch carries its icon and label (never colour alone). */
export function Legend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('text-xs', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white/5 px-3 font-semibold text-fg/75 ring-1 ring-white/10 hover:bg-white/10 xl:hidden"
      >
        <span className="flex -space-x-1">
          {ORDER.slice(0, 4).map((s) => (
            <span key={s} className="h-3 w-3 rounded-full ring-2 ring-ink-800" style={{ background: SOURCES[s].color }} />
          ))}
        </span>
        Legend
        <ChevronDown className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden xl:hidden">
            <Items className="pt-3" />
          </motion.div>
        )}
      </AnimatePresence>
      <Items className="hidden xl:flex" />
    </div>
  )
}

function Items({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-3 gap-y-2', className)} aria-label="Calendar legend">
      {ORDER.map((k) => {
        const s = SOURCES[k]
        return (
          <li key={k} className="flex items-center gap-1.5 text-muted">
            <span
              className={cn('flex h-4 w-5 items-center justify-center rounded', k === 'maintenance' && 'pp-hatch')}
              style={{ backgroundColor: alpha(s.color, 0.2), boxShadow: `inset 2px 0 0 ${s.color}` }}
            >
              <s.icon className="h-2.5 w-2.5" style={{ color: s.color }} aria-hidden />
            </span>
            {s.label}
          </li>
        )
      })}
      <li className="flex items-center gap-1.5 text-muted">
        <span className="pp-held h-4 w-5 rounded" /> Held (paying on Pytch)
      </li>
      <li className="flex items-center gap-1.5 text-muted">
        <span className="flex h-4 w-5 items-center justify-center rounded ring-2 ring-flare">
          <AlertTriangle className="h-2.5 w-2.5 text-flare" />
        </span>
        Conflict
      </li>
      <li className="flex items-center gap-1.5 text-muted">
        <span className="h-4 w-5 rounded ring-1 ring-white/15" /> Free
      </li>
      <li className="flex items-center gap-1.5 text-muted">
        <span className="pp-hatch h-4 w-5 rounded opacity-60 ring-1 ring-white/10" /> Closed
      </li>
    </ul>
  )
}
