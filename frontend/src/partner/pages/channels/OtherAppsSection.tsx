import { ArrowRight, Info } from 'lucide-react'
import { Link } from 'react-router'
import { alpha } from '@/lib/color'
import { Panel } from '../../components/kit'
import { OTHER_APPS, SOURCES } from '../../lib/sources'

export function OtherAppsSection() {
  return (
    <Panel
      id="apps"
      title="Other booking apps"
      subtitle="Bookings from Playo, Hudle and KheloMore don’t reach Pytch on their own — so mirror each one here the moment it comes in."
    >
      <ol className="mb-5 grid gap-2 sm:grid-cols-3">
        {[
          ['A booking lands on another app', 'You get their usual notification.'],
          ['Tap the slot on your Pytch calendar', 'Pick the app as the source — two taps.'],
          ['It’s locked on Pytch instantly', 'No Pytch player can book it any more.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/8">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-volt font-mono text-xs font-bold text-ink-950">{i + 1}</span>
            <span>
              <span className="block text-sm font-semibold">{t}</span>
              <span className="block text-xs text-muted">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {OTHER_APPS.map((app) => {
          const s = SOURCES[app]
          return (
            <Link
              key={app}
              to={`/partner/calendar?source=${app}`}
              className="group flex items-center gap-3 rounded-2xl p-4 ring-1 transition hover:-translate-y-0.5"
              style={{ background: alpha(s.color, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(s.color, 0.3)}` }}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: alpha(s.color, 0.16) }}>
                <s.icon className="h-5 w-5" style={{ color: s.color }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-xs text-muted">Mirror a booking</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5" />
            </Link>
          )
        })}
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Works the other way too: the moment a Pytch booking comes in, block that slot in your other apps.
      </p>
    </Panel>
  )
}
