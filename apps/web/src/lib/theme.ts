/**
 * Theme and accent colour maths, shared by the ThemeProvider and the pre-paint init script.
 * The default accent (cobalt) lives in globals.css; a user-picked accent is turned into the same
 * CSS variables here, with its text and tint variants checked for WCAG contrast in both themes.
 */

export interface AccentPreset {
  name: string;
  hex: string;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export const DEFAULT_ACCENT = '#3e63dd';

/** The pre-redesign default (LTD's brand orchid). A saved value equal to it is treated as "default". */
export const LEGACY_DEFAULT_ACCENT = '#d86dfc';

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Cobalt', hex: '#3e63dd' },
  { name: 'Teal', hex: '#0b7f78' },
  { name: 'Violet', hex: '#6e56cf' },
  { name: 'Rose', hex: '#d6336c' },
  { name: 'Amber', hex: '#f5a524' },
  { name: 'Graphite', hex: '#2a2f37' },
];

export const THEME_STORAGE_KEY = 'workspace_theme';
export const ACCENT_STORAGE_KEY = 'workspace_accent_color';
export const ACCENT_CSS_STORAGE_KEY = 'workspace_accent_css';
export const ACCENT_STYLE_ID = 'accent-vars';

/** Surfaces the accent text must stay readable on (globals.css --surface in each theme). */
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#16191f';

/**
 * Runs in <head> before first paint: applies the saved theme (or the OS preference) and the saved
 * accent CSS, so neither flashes on load. Mirrors ThemeProvider's applyTheme/applyAccent.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var c=localStorage.getItem('${ACCENT_CSS_STORAGE_KEY}');if(c){var s=document.createElement('style');s.id='${ACCENT_STYLE_ID}';s.textContent=c;document.head.appendChild(s);}}catch(e){}})();`;

type Rgb = [number, number, number];

export function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear sRGB mix: `amount` 0 returns `from`, 1 returns `to`. */
export function mixColors(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as Rgb);
}

/**
 * Calculates relative luminance according to WCAG 2.1 specifications.
 */
export function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return 0.5;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255)) as Rgb;

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). */
export function getContrastRatio(a: string, b: string): number {
  const [hi, lo] = [getRelativeLuminance(a), getRelativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
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

/**
 * Returns `hex`, or the closest shade of it, that reaches `minRatio` contrast against `background`.
 * Used to derive readable accent text (links, active labels, focus rings) from any accent the user
 * picks, separately for the light and the dark theme.
 */
export function ensureContrast(hex: string, background: string, minRatio: number): string {
  if (getContrastRatio(hex, background) >= minRatio) return hex;
  const target = getContrastRatio('#000000', background) >= getContrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
  if (getContrastRatio(target, background) < minRatio) return target;
  // Binary search for the smallest mix toward black/white that passes. `hi` only ever holds a
  // tested (rounded) passing mix, so the result always meets the ratio.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (getContrastRatio(mixColors(hex, target, mid), background) >= minRatio) hi = mid;
    else lo = mid;
  }
  return mixColors(hex, target, hi);
}

const channels = (hex: string) => hexToRgb(hex).join(' ');

/**
 * CSS overriding the accent tokens for a custom accent, in both themes.
 * Text variants are checked against the accent tint (the darker/lighter of the two surfaces they sit on).
 */
export function buildAccentCss(hex: string): string {
  const lightSubtle = mixColors(hex, LIGHT_SURFACE, 0.9);
  const darkSubtle = mixColors(hex, DARK_SURFACE, 0.8);
  // A fill too close to the dark surface (e.g. graphite) would vanish in dark mode: use its readable shade instead.
  const darkFill = getContrastRatio(hex, DARK_SURFACE) < 2 ? ensureContrast(hex, DARK_SURFACE, 7) : hex;

  return [
    `:root{--accent:${channels(hex)};--accent-hover:${channels(mixColors(hex, '#000000', 0.12))};` +
      `--accent-fg:${channels(getBestContrastForeground(hex))};` +
      `--accent-text:${channels(ensureContrast(hex, lightSubtle, 4.5))};--accent-subtle:${channels(lightSubtle)}}`,
    `.dark{--accent:${channels(darkFill)};--accent-hover:${channels(mixColors(darkFill, '#ffffff', 0.12))};` +
      `--accent-fg:${channels(getBestContrastForeground(darkFill))};` +
      `--accent-text:${channels(ensureContrast(hex, darkSubtle, 4.5))};--accent-subtle:${channels(darkSubtle)}}`,
  ].join('\n');
}
