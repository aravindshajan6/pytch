import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

export function DetailHeader({
  back,
  backLabel,
  title,
  meta,
  actions,
  leading,
}: {
  back: string
  backLabel: string
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  leading?: React.ReactNode
}) {
  return (
    <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="mb-5">
      <Link to={back} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold sm:text-2xl">{title}</h1>
            {meta && <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </motion.header>
  )
}
