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
        border: 'hsl(var(--border, 214 32% 91%))',
        input: 'hsl(var(--input, 214 32% 91%))',
        ring: 'hsl(var(--ring, 222 84% 4.9%))',
        background: 'hsl(var(--background, 0 0% 100%))',
        foreground: 'hsl(var(--foreground, 222 84% 4.9%))',
        primary: {
          DEFAULT: 'hsl(var(--primary, 222 47% 11%))',
          foreground: 'hsl(var(--primary-foreground, 210 40% 98%))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted, 210 40% 96.1%))',
          foreground: 'hsl(var(--muted-foreground, 215.4 16.3% 46.9%))',
        },
        card: {
          DEFAULT: 'hsl(var(--card, 0 0% 100%))',
          foreground: 'hsl(var(--card-foreground, 222 84% 4.9%))',
        },
      },
      borderRadius: {
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
      },
    },
  },
  plugins: [],
};

export default config;
