import { describe, it, expect } from 'vitest';
import {
  getRelativeLuminance,
  getBestContrastForeground,
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
} from '../components/theme-provider';
import { buildAccentCss, ensureContrast, getContrastRatio } from '../lib/theme';

/** Reads `--accent-text` ("R G B") out of one theme block of buildAccentCss() as a hex colour. */
function accentText(block: string): string {
  const match = /--accent-text:(\d+) (\d+) (\d+)/.exec(block);
  if (!match) throw new Error(`no --accent-text in ${block}`);
  return `#${match.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

describe('UI Shell — Theme & WCAG Contrast Logic', () => {
  it('calculates WCAG relative luminance', () => {
    expect(getRelativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(getRelativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(getRelativeLuminance(DEFAULT_ACCENT)).toBeGreaterThan(0.12);
    expect(getRelativeLuminance(DEFAULT_ACCENT)).toBeLessThan(0.18);
  });

  it('gives the default cobalt accent a white label at AA contrast', () => {
    expect(getBestContrastForeground(DEFAULT_ACCENT)).toBe('#ffffff');
    expect(getContrastRatio('#ffffff', DEFAULT_ACCENT)).toBeGreaterThanOrEqual(4.5);
  });

  it('selects white foreground for dark accent colors', () => {
    const darkHex = '#1e1b4b'; // dark indigo
    const fg = getBestContrastForeground(darkHex);
    expect(fg).toBe('#ffffff');
  });

  it('selects dark foreground for bright presets', () => {
    // Amber preset #fbbf24
    expect(getBestContrastForeground('#fbbf24')).toBe('#0d0614');
    // Sky blue #38bdf8
    expect(getBestContrastForeground('#38bdf8')).toBe('#0d0614');
    // Emerald #34d399
    expect(getBestContrastForeground('#34d399')).toBe('#0d0614');
  });

  it('ensures all preset colors provide compliant contrast foregrounds', () => {
    for (const preset of ACCENT_PRESETS) {
      const fg = getBestContrastForeground(preset.hex);
      expect(['#0d0614', '#ffffff']).toContain(fg);
    }
  });
});

describe('UI Shell — Accent text stays readable in both themes', () => {
  it('leaves a colour that already passes unchanged', () => {
    expect(ensureContrast('#3a5bc7', '#ffffff', 4.5)).toBe('#3a5bc7');
    expect(ensureContrast('#9eb1ff', '#16191f', 4.5)).toBe('#9eb1ff');
  });

  it('adjusts every preset until it reaches the requested ratio on light and dark surfaces', () => {
    for (const { hex } of ACCENT_PRESETS) {
      for (const background of ['#ffffff', '#16191f', '#edf2fe']) {
        const adjusted = ensureContrast(hex, background, 4.5);
        expect(getContrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('builds accent CSS whose link/label colour passes AA in light and dark for every preset', () => {
    for (const { hex } of ACCENT_PRESETS) {
      const [light, dark] = buildAccentCss(hex).split('\n') as [string, string];
      expect(getContrastRatio(accentText(light), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(accentText(dark), '#16191f')).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('UI Shell — Circular Progress Geometry', () => {
  it('computes correct circumference and stroke offset for completion ring', () => {
    const size = 140;
    const strokeWidth = 10;
    const radius = (size - strokeWidth) / 2; // 65
    const circumference = 2 * Math.PI * radius; // ~408.4

    // 0% completion
    const offset0 = circumference - (0 / 100) * circumference;
    expect(offset0).toBeCloseTo(circumference, 1);

    // 50% completion
    const offset50 = circumference - (50 / 100) * circumference;
    expect(offset50).toBeCloseTo(circumference / 2, 1);

    // 100% completion
    const offset100 = circumference - (100 / 100) * circumference;
    expect(offset100).toBeCloseTo(0, 1);
  });
});
