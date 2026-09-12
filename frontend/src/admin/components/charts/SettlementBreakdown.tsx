import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { AdminSettlementDetail } from '@/types/admin'
import { bpsToPct, inr } from '../../lib/format'

/**
 * Part-to-whole of where the gross goes (5 categorical slots, validated order), with 2px surface gaps
 * between segments, plus the line-by-line statement as its table twin.
 */
export function SettlementBreakdown({ s }: { s: AdminSettlementDetail }) {
  const [hover, setHover] = useState<string | null>(null)
  const adj = s.adjustments_paise ?? 0
  const taxes = s.tcs_paise + s.tds_paise
  const deductions = s.refunds_paise + s.provider_discounts_paise + Math.max(0, -adj)
  const segs = [
    { key: 'net', label: 'Net to provider', value: Math.max(0, s.net_payable_paise), color: 'var(--chart-1)' },
    { key: 'comm', label: 'Pytch commission', value: s.commission_paise, color: 'var(--chart-2)' },
    { key: 'gst', label: 'GST on commission', value: s.gst_on_commission_paise, color: 'var(--chart-3)' },
    { key: 'tax', label: 'TCS + TDS withheld', value: taxes, color: 'var(--chart-4)' },
    { key: 'ded', label: 'Refunds, venue discounts & adj.', value: deductions, color: 'var(--chart-5)' },
  ].filter((x) => x.value > 0)
  const total = segs.reduce((a, b) => a + b.value, 0) || 1

  const lines: [string, number, 'plus' | 'minus' | 'total' | 'base'][] = [
    ['Gross pitch fees', s.gross_paise, 'base'],
    ['Refunds borne by venue', -s.refunds_paise, 'minus'],
    ['Venue-funded coupon discounts', -s.provider_discounts_paise, 'minus'],
    ...(adj ? ([['Manual adjustments', adj, adj > 0 ? 'plus' : 'minus']] as [string, number, 'plus' | 'minus'][]) : []),
    [`Commission (${bpsToPct(s.commission_bps)})`, -s.commission_paise, 'minus'],
    ['GST 18% on commission', -s.gst_on_commission_paise, 'minus'],
    ['TCS (GST s.52)', -s.tcs_paise, 'minus'],
    ['TDS (s.194-O)', -s.tds_paise, 'minus'],
    ['Net payable', s.net_payable_paise, 'total'],
  ]

  return (
    <div>
      <div className="flex h-4 w-full gap-[2px]" role="img" aria-label={segs.map((x) => `${x.label} ${inr(x.value)}`).join(', ')}>
        {segs.map((x, i) => (
          <div
            key={x.key}
            onMouseEnter={() => setHover(x.key)}
            onMouseLeave={() => setHover(null)}
            className={cn('h-full transition-[filter]', i === 0 && 'rounded-l-[4px]', i === segs.length - 1 && 'rounded-r-[4px]')}
            style={{ width: `${(x.value / total) * 100}%`, background: x.color, filter: hover && hover !== x.key ? 'saturate(0.5) opacity(0.55)' : undefined }}
            title={`${x.label}: ${inr(x.value)} (${((x.value / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
        {segs.map((x) => (
          <li key={x.key} className={cn('inline-flex items-center gap-1.5 text-muted', hover === x.key && 'text-fg')} onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: x.color }} />
            {x.label}
            <span className="num text-fg">{((x.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>

      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">Settlement statement</caption>
        <tbody>
          {lines.map(([label, v, kind]) => (
            <tr key={label} className={cn(kind === 'total' ? 'border-t border-white/12' : '', kind === 'base' ? 'font-medium' : '')}>
              <td className={cn('py-1.5 pr-3', kind === 'total' ? 'pt-3 font-semibold' : kind === 'base' ? '' : 'text-muted')}>{label}</td>
              <td className={cn('num py-1.5 text-right', kind === 'total' ? 'pt-3 text-lg font-semibold' : v === 0 ? 'text-subtle' : kind === 'plus' ? 'text-mint' : '')}>
                {kind === 'minus' && v !== 0 ? '− ' : kind === 'plus' ? '+ ' : ''}
                {inr(Math.abs(v))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-subtle">Tax rates are configuration — confirm with the CA before go-live. TDS is 5% when the provider has no PAN on file.</p>
    </div>
  )
}
