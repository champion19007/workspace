import type { Config } from 'tailwindcss';

/** Tokens live in src/app/globals.css as "R G B" channels; this keeps opacity modifiers working. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Replaces Tailwind's palette on purpose: only design tokens are available, so a one-off
    // `text-rose-400` can't creep back in and break the light theme.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#ffffff',
      black: '#000000',
      canvas: token('canvas'),
      surface: { DEFAULT: token('surface'), 2: token('surface-2'), 3: token('surface-3') },
      border: { DEFAULT: token('border'), strong: token('border-strong') },
      input: token('input'),
      fg: { DEFAULT: token('fg'), muted: token('fg-muted'), subtle: token('fg-subtle') },
      accent: {
        DEFAULT: token('accent'),
        hover: token('accent-hover'),
        fg: token('accent-fg'),
        text: token('accent-text'),
        subtle: token('accent-subtle'),
      },
      success: { DEFAULT: token('success'), subtle: token('success-subtle') },
      warning: { DEFAULT: token('warning'), subtle: token('warning-subtle') },
      danger: { DEFAULT: token('danger'), subtle: token('danger-subtle'), solid: token('danger-solid') },
      info: { DEFAULT: token('info'), subtle: token('info-subtle') },
      overlay: token('overlay'),
    },
    extend: {
      borderColor: { DEFAULT: token('border') },
      ringColor: { DEFAULT: token('accent-text') },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        xs: '0 1px 1px rgb(var(--shadow) / 0.04)',
        sm: '0 1px 2px rgb(var(--shadow) / 0.06)',
        DEFAULT: '0 1px 3px rgb(var(--shadow) / 0.08)',
        md: '0 4px 12px rgb(var(--shadow) / 0.08)',
        lg: '0 8px 24px rgb(var(--shadow) / 0.12)',
        xl: '0 16px 40px rgb(var(--shadow) / 0.16)',
        '2xl': '0 24px 64px rgb(var(--shadow) / 0.24)',
      },
      fontFamily: {
        sans: [
          '"Segoe UI Variable Text"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', '"Cascadia Code"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(24px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-left': { from: { opacity: '0', transform: 'translateX(-24px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'slide-in-left': 'slide-in-left 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
