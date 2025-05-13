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
      path: '../../public/fonts/soehne-dreiviertelfett.woff2',
      weight: '600', // Semi-bold / Demi-bold (approx. for Dreiviertelfett)
      style: 'normal',
    },
    {
      path: '../../public/fonts/soehne-kraftig.woff2',
      weight: '700', // Bold (Kraftig) - this will be used for font-weight: bold
      style: 'normal',
    },
  ],
  variable: '--font-soehne', // This creates a CSS variable named --font-soehne
  display: 'swap', // Ensures text remains visible while the font loads
});

// If you also use Geist Mono and it's set up via next/font, keep its definition or import.
// For example, if it's like this:
// import { GeistMono } from 'geist/font/mono';
// export const geistMono = GeistMono; // Or however it's exported for layout.tsx