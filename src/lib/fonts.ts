import localFont from 'next/font/local';

export const soehne = localFont({
  src: [
    {
      path: '../../public/fonts/soehne-leicht.woff2', // Path relative to this file (src/lib/fonts.ts)
      weight: '300', // Light
      style: 'normal',
    },
    {
      path: '../../public/fonts/soehne-buch.woff2',
      weight: '400', // Normal/Book - this will be your default weight
      style: 'normal',
    },
    {
      path: '../../public/fonts/soehne-kraftig.woff2',
      weight: '700', // Bold (Kraftig)
      style: 'normal',
    },
    {
      path: '../../public/fonts/soehne-dreiviertelfett.woff2',
      weight: '800', // Extra Bold (Dreiviertelfett - literally "three-quarter fat")
      style: 'normal',
    },
  ],
  variable: '--font-soehne', // This creates a CSS variable named --font-soehne
  display: 'swap', // Ensures text remains visible while the font loads
});

export const signifier = localFont({
  src: [
    {
      path: '../../public/fonts/signifier-light.woff2',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../../public/fonts/signifier-light-italic.woff2',
      weight: '300',
      style: 'italic',
    },
    {
      path: '../../public/fonts/signifier-regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/signifier-regular-italic.woff2',
      weight: '400',
      style: 'italic',
    },
  ],
  variable: '--font-signifier',
  display: 'swap',
});

// If you also use Geist Mono and it's set up via next/font, keep its definition or import.
// For example, if it's like this:
// import { GeistMono } from 'geist/font/mono';
// export const geistMono = GeistMono; // Or however it's exported for layout.tsx