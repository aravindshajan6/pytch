import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { forwardRef } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/lib/cn'

export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background,box-shadow,color,opacity] duration-200 disabled:pointer-events-none disabled:opacity-45 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-volt text-ink-950 hover:bg-volt-soft shadow-[0_0_0_1px_color-mix(in_srgb,_var(--color-volt)_40%,_transparent),0_10px_30px_-10px_color-mix(in_srgb,_var(--color-volt)_60%,_transparent)] hover:shadow-glow-volt',
        secondary: 'glass text-fg hover:bg-white/10',
        ghost: 'text-fg/80 hover:text-fg hover:bg-white/6',
        outline: 'border border-white/15 text-fg hover:border-volt/60 hover:text-volt',
        danger: 'bg-flare text-snow hover:brightness-110 shadow-[0_10px_30px_-10px_color-mix(in_srgb,_var(--color-flare)_70%,_transparent)]',
        electric: 'bg-electric text-ink-950 hover:brightness-110 shadow-[0_10px_30px_-10px_color-mix(in_srgb,_var(--color-electric)_70%,_transparent)]',
      },
      size: {
        sm: 'h-8 rounded-lg px-3 text-xs',
        md: 'h-11 rounded-xl px-5 text-sm',
        lg: 'h-14 rounded-2xl px-7 text-base',
        icon: 'h-10 w-10 rounded-xl',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type Variants = VariantProps<typeof buttonVariants>

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'>, Variants {
  loading?: boolean
  children?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading, disabled, children, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  )
})

export function LinkButton({
  className,
  variant,
  size,
  block,
  ...props
}: LinkProps & Variants & { className?: string }) {
  return <Link className={cn(buttonVariants({ variant, size, block }), className)} {...props} />
}
