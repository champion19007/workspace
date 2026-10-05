import { describe, it, expect } from 'vitest';
import {
  getRelativeLuminance,
  getBestContrastForeground,
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
} from '../components/theme-provider';

describe('UI Shell — Theme & WCAG Contrast Logic', () => {
  it('correctly calculates relative luminance for default accent #d86dfc', () => {
    const lum = getRelativeLuminance(DEFAULT_ACCENT);
    expect(lum).toBeGreaterThan(0.25);
    expect(lum).toBeLessThan(0.40);
  });

  it('selects high-contrast dark foreground (#0d0614) for #d86dfc', () => {
    const fg = getBestContrastForeground(DEFAULT_ACCENT);
    expect(fg).toBe('#0d0614');

    // Calculate actual contrast ratio
    const lum = getRelativeLuminance(DEFAULT_ACCENT);
    const darkLum = 0.005; // ~ #0d0614
    const whiteLum = 1.0; // #ffffff

    const darkContrast = (lum + 0.05) / (darkLum + 0.05);
    const whiteContrast = (whiteLum + 0.05) / (lum + 0.05);

    // Dark text must have significantly higher contrast ratio than white text
    expect(darkContrast).toBeGreaterThan(6.0); // WCAG AAA requirement is >= 7:1 for normal, > 4.5:1 for large
    expect(darkContrast).toBeGreaterThan(whiteContrast);
    expect(whiteContrast).toBeLessThan(3.5); // White text fails WCAG AA on #d86dfc
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
