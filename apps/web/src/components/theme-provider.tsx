'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface AccentPreset {
  name: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Default Orchid', hex: '#d86dfc' },
  { name: 'Sky Blue', hex: '#38bdf8' },
  { name: 'Emerald', hex: '#34d399' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#fbbf24' },
  { name: 'Indigo', hex: '#818cf8' },
];

export const DEFAULT_ACCENT = '#d86dfc';

interface ThemeContextType {
  accentColor: string;
  accentForeground: string;
  setAccentColor: (hex: string) => void;
  resetAccentColor: () => void;
  presets: AccentPreset[];
}

const ThemeContext = createContext<ThemeContextType>({
  accentColor: DEFAULT_ACCENT,
  accentForeground: '#0d0614',
  setAccentColor: () => {},
  resetAccentColor: () => {},
  presets: ACCENT_PRESETS,
});

/**
 * Calculates relative luminance according to WCAG 2.1 specifications.
 */
export function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return 0.5;

  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Chooses the foreground color (#0d0614 or #ffffff) that delivers the highest WCAG contrast.
 */
export function getBestContrastForeground(hex: string): string {
  const lum = getRelativeLuminance(hex);
  const darkLum = 0.005; // ~ #0d0614
  const lightLum = 1.0; // ~ #ffffff

  const darkRatio = (lum + 0.05) / (darkLum + 0.05);
  const lightRatio = (lightLum + 0.05) / (lum + 0.05);

  return darkRatio >= lightRatio ? '#0d0614' : '#ffffff';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState<string>(DEFAULT_ACCENT);
  const [accentForeground, setAccentForegroundState] = useState<string>('#0d0614');

  const applyColors = (hex: string) => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return;

    const fg = getBestContrastForeground(hex);
    setAccentColorState(hex);
    setAccentForegroundState(fg);

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.style.setProperty('--accent', hex);
      root.style.setProperty('--accent-foreground', fg);
      root.style.setProperty('--accent-muted', `${hex}26`); // 15% opacity
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('workspace_accent_color');
      if (saved && /^#[0-9A-Fa-f]{6}$/.test(saved)) {
        applyColors(saved);
      } else {
        applyColors(DEFAULT_ACCENT);
      }
    } catch {
      // Storage unavailable or SSR
      applyColors(DEFAULT_ACCENT);
    }
  }, []);

  const setAccentColor = (hex: string) => {
    applyColors(hex);
    try {
      localStorage.setItem('workspace_accent_color', hex);
    } catch {
      // ignore storage errors
    }
  };

  const resetAccentColor = () => {
    applyColors(DEFAULT_ACCENT);
    try {
      localStorage.removeItem('workspace_accent_color');
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        accentColor,
        accentForeground,
        setAccentColor,
        resetAccentColor,
        presets: ACCENT_PRESETS,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
