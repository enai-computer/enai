import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        step: {
          1: 'var(--step-1)',
          2: 'var(--step-2)',
          3: 'var(--step-3)',
          4: 'var(--step-4)',
          5: 'var(--step-5)',
          6: 'var(--step-6)',
          7: 'var(--step-7)',
          8: 'var(--step-8)',
          9: 'var(--step-9)',
          10: 'var(--step-10)',
          11: 'var(--step-11)',
          '11.5': 'var(--step-11-5)',
          12: 'var(--step-12)',
        },
        /**
         * @deprecated Semantic color names will be removed in a future
         * release. Use the step palette instead. These aliases are kept for
         * compatibility during the migration.
         */
        primary: {
          DEFAULT: 'var(--step-11)',
          foreground: 'var(--step-1)',
        },
        secondary: {
          DEFAULT: 'var(--step-2)',
          foreground: 'var(--step-11)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'var(--step-2)',
          foreground: 'var(--step-10)',
        },
        accent: {
          DEFAULT: 'var(--step-2)',
          foreground: 'var(--step-11)',
        },
        popover: {
          DEFAULT: 'var(--step-1)',
          foreground: 'var(--step-12)',
        },
        card: {
          DEFAULT: 'var(--step-1)',
          foreground: 'var(--step-12)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)'],
        mono: ['var(--font-geist-mono)'],
        soehne: ['var(--font-soehne)'],
      },
    },
  },
  plugins: [
    // Note: tailwindcss-animate is not compatible with Tailwind CSS v4
    // Animation utilities are now built into Tailwind CSS v4
    function({ addUtilities }) {
      const newUtilities = {
        '.will-change-transform': {
          'will-change': 'transform',
        },
        '.will-change-scroll': {
          'will-change': 'scroll-position',
        },
        '.will-change-contents': {
          'will-change': 'contents',
        },
        '.no-drag': {
          '-webkit-app-region': 'no-drag',
        },
      }
      addUtilities(newUtilities)
    }
  ],
}

export default config 