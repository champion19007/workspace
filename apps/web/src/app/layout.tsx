import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Workspace v1 — Platform Foundation',
  description: 'Meeting notes, evidence-grounded action items, and project task management.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
