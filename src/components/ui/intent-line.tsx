import * as React from "react"

import { cn } from "@/lib/utils"

// Define the props for the IntentLine component.
// It will accept all standard HTML input attributes.
export interface IntentLineProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const IntentLine = React.forwardRef<HTMLInputElement, IntentLineProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type || "text"} // Default to "text" if no type is provided
        className={cn(
          // Base styles copied from the existing Input component
          "file:text-step-12 placeholder:text-step-10 selection:bg-step-11 selection:text-step-1 border-step-12/20 flex h-9 w-full min-w-0 border px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          // Allow for additional classes to be passed in
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
IntentLine.displayName = "IntentLine"

export { IntentLine }
