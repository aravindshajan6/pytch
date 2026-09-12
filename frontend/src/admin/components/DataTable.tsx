import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/States'
import { cn } from '@/lib/cn'

export interface Column<T> {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Enables client-side sorting on this column. */
  sortValue?: (row: T) => string | number | null
  align?: 'left' | 'right' | 'center'
  className?: string
  headerClassName?: string
  /** Hide on narrow screens. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

/**
 * Sticky-header table with optional client sort, skeleton rows, empty state, keyboard row activation
 * (Tab to a row, Enter/Space to open) and optional expandable rows.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  onRowClick,
  empty,
  skeletonRows = 8,
  maxHeight = 'max-h-[min(70dvh,760px)]',
  expanded,
  renderExpanded,
  rowClassName,
  dim,
  caption,
}: {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string
  loading?: boolean
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  skeletonRows?: number
  maxHeight?: string
  expanded?: string | null
  renderExpanded?: (row: T) => React.ReactNode
  rowClassName?: (row: T) => string | undefined
  /** Hold previous rows at reduced opacity while refetching (no skeleton flash). */
  dim?: boolean
  caption?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, sort, columns])

  const alignCls = (a?: Column<T>['align']) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')

  return (
    <div className={cn('relative overflow-auto', maxHeight, dim && 'opacity-60 transition-opacity')}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'sticky top-0 z-10 border-b border-white/8 bg-ink-800/95 px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase backdrop-blur first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
                    alignCls(c.align),
                    c.hideBelow && HIDE[c.hideBelow],
                    c.headerClassName,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => setSort(active ? (sort!.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: -1 })}
                      className={cn('inline-flex cursor-pointer items-center gap-1 uppercase hover:text-fg', active && 'text-fg')}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !rows
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('border-b border-white/5 px-3 py-3 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5', c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className={cn('h-4 rounded-md', c.align === 'right' ? 'ml-auto w-16' : 'w-[70%]')} />
                    </td>
                  ))}
                </tr>
              ))
            : sorted?.map((row) => {
                const key = rowKey(row)
                const isOpen = expanded === key
                return (
                  <Fragment key={key}>
                    <tr
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.target !== e.currentTarget) return
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onRowClick(row)
                              }
                            }
                          : undefined
                      }
                      aria-expanded={renderExpanded ? isOpen : undefined}
                      className={cn(
                        'group transition-colors',
                        onRowClick && 'cursor-pointer hover:bg-[var(--admin-row-hover)] focus-visible:bg-[var(--admin-row-hover)] focus-visible:outline-none',
                        isOpen && 'bg-[var(--admin-row-hover)]',
                        rowClassName?.(row),
                      )}
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'border-b border-white/5 px-3 py-2.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
                            alignCls(c.align),
                            c.hideBelow && HIDE[c.hideBelow],
                            c.className,
                          )}
                        >
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                    {isOpen && renderExpanded && (
                      <tr>
                        <td colSpan={columns.length} className="border-b border-white/5 bg-white/[0.02] px-4 py-4 sm:px-5">
                          {renderExpanded(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && (
        <div className="px-6 py-14 text-center text-sm text-muted">{empty ?? 'Nothing here yet.'}</div>
      )}
    </div>
  )
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
  className,
}: {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
  className?: string
}) {
  if (total <= limit && offset === 0) return total ? <div className={cn('px-5 py-3 text-xs text-subtle', className)}>{total.toLocaleString('en-IN')} total</div> : null
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)
  const btn =
    'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-35'
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted sm:px-5', className)}>
      <span className="num">
        {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className={btn} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
