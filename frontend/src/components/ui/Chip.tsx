import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const chip = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium', {
  variants: {
    tone: {
      neutral: 'bg-white/6 text-fg/80 ring-1 ring-white/10',
      volt: 'bg-volt/12 text-volt ring-1 ring-volt/30',
      mint: 'bg-mint/12 text-mint ring-1 ring-mint/30',
      electric: 'bg-electric/12 text-electric ring-1 ring-electric/30',
      flare: 'bg-flare/15 text-flare ring-1 ring-flare/35',
      sun: 'bg-sun/15 text-sun ring-1 ring-sun/35',
      grape: 'bg-grape/15 text-[var(--color-grape-soft)] ring-1 ring-grape/40',
      solid: 'bg-volt text-ink-950',
    },
    size: {
      xs: 'h-5 px-2 text-[10px]',
      sm: 'h-6 px-2.5 text-[11px]',
      md: 'h-8 px-3 text-xs',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
})

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof chip> {
  dot?: boolean
}

export function Chip({ className, tone, size, dot, children, ...props }: ChipProps) {
  return (
    <span className={cn(chip({ tone, size }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 animate-blink rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Toggleable filter chip. */
export function FilterChip({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-volt text-ink-950 shadow-[0_0_24px_-6px_color-mix(in_srgb,_var(--color-volt)_70%,_transparent)]'
          : 'bg-white/5 text-fg/75 ring-1 ring-white/10 hover:bg-white/10 hover:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
