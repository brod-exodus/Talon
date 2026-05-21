import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'prism-gradient text-primary-foreground shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/25',
        destructive:
          'bg-destructive text-white shadow-lg shadow-rose-500/15 hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline:
          'border border-white/70 bg-white/70 text-foreground shadow-sm shadow-indigo-500/5 backdrop-blur-md hover:bg-white hover:text-primary',
        secondary:
          'bg-indigo-50 text-primary hover:bg-indigo-100',
        ghost:
          'text-muted-foreground hover:bg-white/70 hover:text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5 py-2 has-[>svg]:px-4',
        sm: 'h-8 gap-1.5 px-3.5 has-[>svg]:px-3',
        lg: 'h-12 px-7 has-[>svg]:px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = (asChild ? Slot : 'button') as React.ElementType

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
