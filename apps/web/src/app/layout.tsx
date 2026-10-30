import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';
import { THEME_INIT_SCRIPT } from '../lib/theme';

export const metadata: Metadata = {
  title: 'Workspace',
  description: 'Projects, tasks, docs and meeting notes, with action items you approve.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The init script sets class="dark" before hydration, so the server and client class lists may differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
