import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mixing & Mastering Studio',
  description: 'Open-source browser-based mixing and mastering studio powered by Web Audio API',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
