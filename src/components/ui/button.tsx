import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-step-8 focus-visible:ring-step-8/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-step-11 text-step-1 shadow-xs hover:bg-birkin",
        destructive:
          "bg-tomato-11 text-white shadow-xs hover:bg-tomato-12 focus-visible:ring-tomato-7 dark:bg-tomato-11 dark:hover:bg-tomato-12 dark:focus-visible:ring-tomato-7",
        outline:
          "border bg-step-1 shadow-xs hover:bg-step-2 hover:text-birkin dark:bg-step-6/30 dark:border-step-6 dark:hover:bg-step-6/50",
        secondary:
          "bg-step-2 text-step-11 shadow-xs hover:bg-step-2/80",
        ghost:
          "hover:bg-step-2 hover:text-birkin dark:hover:bg-step-2/50",
        link: "text-step-11 underline-offset-4 hover:underline hover:text-birkin transition-colors duration-200",
        browserAction:
          "bg-step-3 text-step-12 hover:bg-step-4 dark:bg-step-3 dark:text-step-12 dark:hover:bg-step-4 focus-visible:ring-0 focus-visible:border-transparent",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
