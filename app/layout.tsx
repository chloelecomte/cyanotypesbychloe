import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cyanotypes by Chloé',
  description: 'Website for my cyanotyping project',
  keywords: ['Cyanotype', 'Art', 'Upcycling'],
  authors: [{ name: 'Chloé le Comte' }],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
