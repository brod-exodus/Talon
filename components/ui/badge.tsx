import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-2 aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-[color,box-shadow,background-color,border-color]',
  {
    variants: {
      variant: {
        default:
          'border-primary/30 bg-primary/10 text-primary [a&]:hover:border-primary/60',
        secondary:
          'border-secondary/25 bg-secondary/10 text-secondary [a&]:hover:border-secondary/50',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline:
          'border-border bg-muted text-muted-foreground [a&]:hover:border-primary/40 [a&]:hover:text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = (asChild ? Slot : 'span') as React.ElementType

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
