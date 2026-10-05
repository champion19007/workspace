import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas, #0d0f12)',
        sidebar: 'var(--sidebar, #0b0d10)',
        panel: {
          DEFAULT: 'var(--panel, #14171e)',
          elevated: 'var(--panel-elevated, #1a1e27)',
          inset: 'var(--panel-inset, #101319)',
        },
        'border-subtle': 'var(--border-subtle, #222633)',
        'border-strong': 'var(--border-strong, #2e3446)',
        accent: {
          DEFAULT: 'var(--accent, #d86dfc)',
          foreground: 'var(--accent-foreground, #0d0614)',
          muted: 'var(--accent-muted, rgba(216, 109, 252, 0.15))',
        },
        // Standard semantic mapping
        border: 'var(--border-subtle, #222633)',
        input: 'var(--border-strong, #2e3446)',
        ring: 'var(--accent, #d86dfc)',
        background: 'var(--canvas, #0d0f12)',
        foreground: 'var(--text-primary, #f8fafc)',
        primary: {
          DEFAULT: 'var(--accent, #d86dfc)',
          foreground: 'var(--accent-foreground, #0d0614)',
        },
        muted: {
          DEFAULT: 'var(--panel-elevated, #1a1e27)',
          foreground: 'var(--text-secondary, #94a3b8)',
        },
        card: {
          DEFAULT: 'var(--panel, #14171e)',
          foreground: 'var(--text-primary, #f8fafc)',
        },
      },
      borderRadius: {
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
