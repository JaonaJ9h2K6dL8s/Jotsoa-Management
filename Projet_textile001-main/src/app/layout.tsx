import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import ThemeRegistry from '@/components/theme/theme-registry';
import '@/styles/globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'JO Management',
    template: '%s — JO Management',
  },
  description: "Gestion intégrée de l'entreprise",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${fraunces.variable} ${instrumentSans.variable}`}>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
