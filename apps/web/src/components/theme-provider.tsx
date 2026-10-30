'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  ACCENT_CSS_STORAGE_KEY,
  ACCENT_PRESETS,
  ACCENT_STORAGE_KEY,
  ACCENT_STYLE_ID,
  DEFAULT_ACCENT,
  LEGACY_DEFAULT_ACCENT,
  THEME_STORAGE_KEY,
  buildAccentCss,
  isHexColor,
  type AccentPreset,
  type ThemePreference,
} from '@/lib/theme';

export {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  getBestContrastForeground,
  getRelativeLuminance,
} from '@/lib/theme';
export type { AccentPreset, ThemePreference } from '@/lib/theme';

interface ThemeContextType {
  /** Saved preference; null until read from storage after mount. */
  theme: ThemePreference | null;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
  accentColor: string;
  setAccentColor: (hex: string) => void;
  resetAccentColor: () => void;
  presets: AccentPreset[];
}

const ThemeContext = createContext<ThemeContextType>({
  theme: null,
  resolvedTheme: 'light',
  setTheme: () => {},
  accentColor: DEFAULT_ACCENT,
  setAccentColor: () => {},
  resetAccentColor: () => {},
  presets: ACCENT_PRESETS,
});

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, blocked): the choice still applies for this visit.
  }
}

/** Writes the accent override style tag (none for the default accent) and caches it for the init script. */
function applyAccent(hex: string) {
  const isDefault = hex.toLowerCase() === DEFAULT_ACCENT;
  let el = document.getElementById(ACCENT_STYLE_ID);
  if (isDefault) {
    el?.remove();
    store(ACCENT_CSS_STORAGE_KEY, null);
    return;
  }
  const css = buildAccentCss(hex);
  if (!el) {
    el = document.createElement('style');
    el.id = ACCENT_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  store(ACCENT_CSS_STORAGE_KEY, css);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT);

  // Read saved choices once mounted. Until then the init script in <head> has already applied them,
  // so nothing here touches the DOM before `theme` is known (that would flash the wrong theme).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(media.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener('change', onChange);

    let savedTheme: string | null = null;
    let savedAccent: string | null = null;
    try {
      savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      savedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setThemeState(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system');

    const accent =
      savedAccent && isHexColor(savedAccent) && savedAccent.toLowerCase() !== LEGACY_DEFAULT_ACCENT
        ? savedAccent
        : DEFAULT_ACCENT;
    if (savedAccent && accent === DEFAULT_ACCENT) store(ACCENT_STORAGE_KEY, null);
    setAccentColorState(accent);
    applyAccent(accent);

    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'dark' || (theme !== 'light' && systemDark) ? 'dark' : 'light';

  useEffect(() => {
    if (theme === null) return;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    store(THEME_STORAGE_KEY, next === 'system' ? null : next);
  }, []);

  const setAccentColor = useCallback((hex: string) => {
    if (!isHexColor(hex)) return;
    setAccentColorState(hex);
    applyAccent(hex);
    store(ACCENT_STORAGE_KEY, hex.toLowerCase() === DEFAULT_ACCENT ? null : hex);
  }, []);

  const resetAccentColor = useCallback(() => setAccentColor(DEFAULT_ACCENT), [setAccentColor]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        accentColor,
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
