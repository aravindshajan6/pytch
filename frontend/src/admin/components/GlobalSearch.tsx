import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Loader2, Search, User } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { adminApi } from '../lib/api'
import { dateShort, maskPhone } from '../lib/format'
import { useCan } from '../lib/session'
import { useDebounced } from '../lib/hooks'

interface Result {
  key: string
  kind: 'booking' | 'player'
  title: string
  subtitle: string
  to: string
}

/** Top-bar search: bookings by code, players by phone or name. Ctrl/⌘-K or "/" to focus. */
export function GlobalSearch({ className }: { className?: string }) {
  const can = useCan()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const term = useDebounced(q.trim(), 250)
  const enabled = term.length >= 2

  const bookings = useQuery({
    queryKey: ['admin', 'search', 'bookings', term],
    queryFn: () => adminApi.bookings.list({ q: term, limit: 5 }),
    enabled: enabled && can('bookings.view'),
    staleTime: 10_000,
  })
  const players = useQuery({
    queryKey: ['admin', 'search', 'players', term],
    queryFn: () => adminApi.users.list({ q: term, limit: 5 }),
    enabled: enabled && can('users.view'),
    staleTime: 10_000,
  })

  const results: Result[] = useMemo(
    () => [
      ...(bookings.data?.items ?? []).map((b) => ({
        key: `b-${b.id}`,
        kind: 'booking' as const,
        title: `${b.code} · ${b.lobby_title}`,
        subtitle: `${b.turf_name} · ${dateShort(b.start_at)}`,
        to: `/bookings/${b.id}`,
      })),
      ...(players.data?.items ?? []).map((u) => ({
        key: `u-${u.id}`,
        kind: 'player' as const,
        title: u.name,
        subtitle: `${maskPhone(u.phone)}${u.home_area ? ` · ${u.home_area}` : ''}`,
        to: `/players/${u.id}`,
      })),
    ],
    [bookings.data, players.data],
  )
  const loading = enabled && (bookings.isFetching || players.isFetching)
  const canSearch = can('bookings.view') || can('users.view')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [])

  const go = (r: Result) => {
    navigate(r.to)
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
  }

  if (!canSearch) return <div className={className} />

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && enabled}
        aria-controls="admin-search-results"
        aria-autocomplete="list"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            go(results[active]!)
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
        placeholder={can('bookings.view') ? 'Search booking code, player name or phone' : 'Search players by name or phone'}
        spellCheck={false}
        autoComplete="off"
        className="h-10 w-full rounded-xl bg-white/5 pr-14 pl-9 text-sm text-fg ring-1 ring-white/10 transition outline-none placeholder:text-subtle focus:bg-white/8 focus:ring-2 focus:ring-volt/60"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-subtle ring-1 ring-white/10 sm:block">
        Ctrl K
      </kbd>
      <AnimatePresence>
        {open && enabled && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            id="admin-search-results"
            role="listbox"
            className="glass-strong absolute top-12 right-0 left-0 z-50 overflow-hidden rounded-xl shadow-2xl"
          >
            {loading && results.length === 0 && (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {!loading && results.length === 0 && <div className="px-4 py-4 text-sm text-muted">No bookings or players match “{term}”.</div>}
            {results.map((r, i) => (
              <button
                key={r.key}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={cn('flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left', i === active && 'bg-white/6')}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  {r.kind === 'booking' ? <CalendarCheck className="h-4 w-4 text-electric" /> : <User className="h-4 w-4 text-volt" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                </span>
                <span className="ml-auto text-[10px] tracking-wider text-subtle uppercase">{r.kind}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
