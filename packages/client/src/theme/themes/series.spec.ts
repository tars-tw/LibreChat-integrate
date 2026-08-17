import type { IThemeRGB } from '../types';
import type { RGB } from '../utils/color';
import { contrastRatio, hueAngle, parseRgb, toHex, worstSeparation } from '../utils/color';
import { defaultTheme } from './default';
import { darkTheme } from './dark';

/**
 * The contract the categorical series scale is held to. Both figures are floors
 * the shipped palettes clear with room (light 3.08 / 24.8, dark 3.42 / 19.0);
 * they exist to catch a retint or an upstream merge that quietly undoes the
 * work, not to pin the exact values.
 *
 * Adjacent slots are the ones that matter: segments touch in the meter with no
 * label between them, while every legend swatch is paired with its own text.
 * That is also why the separation floor is well above a "just noticeable"
 * ΔE — two touching fills have to read as two categories at a glance.
 */
const MIN_CONTRAST = 3.0;
const MIN_ADJACENT_SEPARATION = 18.0;

const SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

function seriesScale(theme: IThemeRGB): RGB[] {
  return SLOTS.map((slot) => {
    const token = theme[`rgb-series-${slot}` as keyof IThemeRGB];
    if (token === undefined) {
      throw new Error(`theme is missing rgb-series-${slot}`);
    }
    return parseRgb(token);
  });
}

function surfaces(theme: IThemeRGB): Array<{ name: string; rgb: RGB }> {
  return [
    { name: 'presentation', rgb: parseRgb(theme['rgb-presentation'] ?? '') },
    { name: 'surface-tertiary', rgb: parseRgb(theme['rgb-surface-tertiary'] ?? '') },
  ];
}

/** Slot 1 carries the brand, at whichever step of it clears the contrast bar. */
function brandOranges(theme: IThemeRGB): RGB[] {
  return [theme['rgb-accent-primary'] ?? '', theme['rgb-accent-primary-hover'] ?? ''].map(parseRgb);
}

describe.each([
  ['default', defaultTheme],
  ['dark', darkTheme],
])('%s theme categorical series scale', (_name, theme) => {
  const scale = seriesScale(theme);

  it('leads with the PwC brand orange', () => {
    const brand = brandOranges(theme).map(toHex);
    expect(brand).toContain(toHex(scale[0]));
  });

  it.each(surfaces(theme))('clears 3:1 against $name on every slot', ({ rgb }: { rgb: RGB }) => {
    const failures = scale.flatMap((colour, index) => {
      const ratio = contrastRatio(colour, rgb);
      return ratio >= MIN_CONTRAST
        ? []
        : [`slot ${index + 1} (${toHex(colour)}): ${ratio.toFixed(2)}:1`];
    });
    expect(failures).toEqual([]);
  });

  it('keeps touching slots apart for normal vision and for dichromats', () => {
    const failures = scale.slice(0, -1).flatMap((colour, index) => {
      const separation = worstSeparation(colour, scale[index + 1]);
      return separation >= MIN_ADJACENT_SEPARATION
        ? []
        : [
            `slots ${index + 1}/${index + 2} (${toHex(colour)} vs ${toHex(scale[index + 1])}): ` +
              `ΔE00 ${separation.toFixed(1)}`,
          ];
    });
    expect(failures).toEqual([]);
  });

  it('gives every slot its own colour', () => {
    expect(new Set(scale.map(toHex)).size).toBe(SLOTS.length);
  });
});

/**
 * Colour follows the category, not the surface. Solving each theme's slot order
 * on its own separation score pulls the two apart and silently repaints every
 * category the moment a reader switches theme, so the orders are pinned
 * together — the tolerance covers the lightness-driven hue drift between a
 * colour and its stepped counterpart, nothing more.
 */
describe('series scale across themes', () => {
  const light = seriesScale(defaultTheme);
  const dark = seriesScale(darkTheme);
  const MAX_HUE_DRIFT = 12;

  it('gives a slot the same hue in both themes', () => {
    const drifted = light.flatMap((colour, index) => {
      const drift = Math.abs(((hueAngle(colour) - hueAngle(dark[index]) + 540) % 360) - 180);
      return drift <= MAX_HUE_DRIFT
        ? []
        : [`slot ${index + 1} (${toHex(colour)} vs ${toHex(dark[index])}): ${drift.toFixed(0)}°`];
    });
    expect(drifted).toEqual([]);
  });
});
