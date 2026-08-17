import type { RGB } from './color';
import {
  deltaE,
  toHex,
  parseRgb,
  simulate,
  contrastRatio,
  readThemeColor,
  worstSeparation,
} from './color';

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [255, 0, 0];
const GREEN: RGB = [0, 200, 0];
const BLUE: RGB = [0, 0, 255];

describe('parseRgb', () => {
  it('reads a theme token', () => {
    expect(parseRgb('224 71 5')).toEqual([224, 71, 5]);
  });

  it('rejects anything that is not three channels in range', () => {
    expect(() => parseRgb('#e04705')).toThrow();
    expect(() => parseRgb('224, 71, 5')).toThrow();
    expect(() => parseRgb('300 71 5')).toThrow();
  });
});

describe('toHex', () => {
  it('pads single-digit channels', () => {
    expect(toHex([1, 131, 1])).toBe('#018301');
  });
});

describe('contrastRatio', () => {
  it('spans the full WCAG range', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('does not depend on argument order', () => {
    expect(contrastRatio(RED, WHITE)).toBeCloseTo(contrastRatio(WHITE, RED), 10);
  });
});

describe('deltaE', () => {
  it('is zero for a colour against itself', () => {
    expect(deltaE(RED, RED)).toBeCloseTo(0, 10);
  });

  it('grows with how far apart two colours look', () => {
    expect(deltaE(RED, [255, 10, 0])).toBeLessThan(deltaE(RED, GREEN));
  });
});

describe('simulate', () => {
  it('collapses red towards green for a deuteranope, leaving blue alone', () => {
    expect(deltaE(simulate(RED, 'deutan'), simulate(GREEN, 'deutan'))).toBeLessThan(
      deltaE(RED, GREEN),
    );
    expect(deltaE(simulate(BLUE, 'deutan'), BLUE)).toBeLessThan(deltaE(RED, GREEN));
  });
});

describe('worstSeparation', () => {
  it('never exceeds the normal-vision distance', () => {
    expect(worstSeparation(RED, GREEN)).toBeLessThanOrEqual(deltaE(RED, GREEN));
  });

  it('is what catches a pair that only normal vision can tell apart', () => {
    expect(deltaE(RED, GREEN)).toBeGreaterThan(50);
    expect(worstSeparation(RED, GREEN)).toBeLessThan(30);
  });
});

describe('readThemeColor', () => {
  const root = document.documentElement;

  afterEach(() => {
    root.removeAttribute('style');
  });

  it('wraps a channel triplet in rgb()', () => {
    root.style.setProperty('--probe', '13 13 13');
    expect(readThemeColor('--probe')).toBe('rgb(13 13 13)');
  });

  it('keeps an alpha written after the triplet', () => {
    root.style.setProperty('--probe', '0 0 0 / 0.4');
    expect(readThemeColor('--probe')).toBe('rgb(0 0 0 / 0.4)');
  });

  it('returns a value that is already a color as set', () => {
    root.style.setProperty('--probe', '#fafafa');
    expect(readThemeColor('--probe')).toBe('#fafafa');
  });

  it('returns null for an unset or unresolved property', () => {
    expect(readThemeColor('--probe')).toBeNull();
    root.style.setProperty('--probe', 'var(--missing)');
    expect(readThemeColor('--probe')).toBeNull();
  });

  it('reads the element it is given', () => {
    const scoped = document.createElement('div');
    scoped.style.setProperty('--probe', '1 2 3');
    document.body.append(scoped);
    expect(readThemeColor('--probe', scoped)).toBe('rgb(1 2 3)');
    scoped.remove();
  });
});
