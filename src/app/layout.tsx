import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { soehne } from '../lib/fonts';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jeffers",
  description: "A calm, intent based computing environment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Keep font variables available on <html> for potential utility class usage
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${soehne.variable} antialiased`}>
      {/* Apply Soehne as the default body font */}
      <body className={soehne.className}>{children}</body>
    </html>
  );
}
