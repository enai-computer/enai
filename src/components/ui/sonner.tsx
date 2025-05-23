"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--step-1)",
          "--normal-text": "var(--step-12)",
          "--normal-border": "var(--step-6)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
