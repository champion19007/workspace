import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';

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
    <html lang="en" className="dark">
      <body className="min-h-screen bg-canvas text-foreground antialiased selection:bg-accent selection:text-accent-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
