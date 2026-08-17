/**
 * Audits — or re-derives — the categorical series scale.
 *
 *   npm run series --                 audit the shipped light and dark scales
 *   npm run series -- solve <slots>   propose a scale for that many slots
 *
 * `series.spec.ts` is the CI guard and holds the contract; this is the bench
 * you reach for when the palette itself has to change — a retint, an eighth
 * category, a new surface underneath the meter. Solving prints candidates for a
 * human to judge; nothing here writes to the theme files.
 */
import { contrastRatio, deltaE, parseRgb, toHex, worstSeparation } from '../src/theme/utils/color';
import { defaultTheme } from '../src/theme/themes/default';
import { darkTheme } from '../src/theme/themes/dark';

import type { IThemeRGB } from '../src/theme/types';
import type { RGB } from '../src/theme/utils/color';

const MIN_CONTRAST = 3.0;

interface Scheme {
  name: string;
  theme: IThemeRGB;
}

const SCHEMES: Scheme[] = [
  { name: 'light', theme: defaultTheme },
  { name: 'dark', theme: darkTheme },
];

function token(theme: IThemeRGB, key: keyof IThemeRGB): RGB {
  const value = theme[key];
  if (value === undefined) {
    throw new Error(`theme is missing ${key}`);
  }
  return parseRgb(value);
}

function scaleOf(theme: IThemeRGB): RGB[] {
  const slots: RGB[] = [];
  for (let slot = 1; ; slot += 1) {
    const value = theme[`rgb-series-${slot}` as keyof IThemeRGB];
    if (value === undefined) {
      return slots;
    }
    slots.push(parseRgb(value));
  }
}

function surfacesOf(theme: IThemeRGB): Array<[string, RGB]> {
  return [
    ['presentation', token(theme, 'rgb-presentation')],
    ['track', token(theme, 'rgb-surface-tertiary')],
  ];
}

function adjacentFloor(scale: RGB[]): number {
  return scale
    .slice(0, -1)
    .reduce(
      (worst, colour, index) => Math.min(worst, worstSeparation(colour, scale[index + 1])),
      Infinity,
    );
}

function allPairsFloor(scale: RGB[], measure: (a: RGB, b: RGB) => number): number {
  let floor = Infinity;
  for (let i = 0; i < scale.length; i += 1) {
    for (let j = i + 1; j < scale.length; j += 1) {
      floor = Math.min(floor, measure(scale[i], scale[j]));
    }
  }
  return floor;
}

function audit({ name, theme }: Scheme): void {
  const scale = scaleOf(theme);
  const surfaces = surfacesOf(theme);
  console.log(`\n${name} — ${scale.length} slots`);
  scale.forEach((colour, index) => {
    const ratios = surfaces
      .map(([label, surface]) => `${label} ${contrastRatio(colour, surface).toFixed(2)}:1`)
      .join('  ');
    const flag = surfaces.every(([, surface]) => contrastRatio(colour, surface) >= MIN_CONTRAST)
      ? ' '
      : '!';
    console.log(` ${flag} slot ${index + 1}  ${toHex(colour)}  ${ratios}`);
  });
  console.log(
    `   adjacent ΔE00 ${adjacentFloor(scale).toFixed(1)} (worst observer)` +
      ` | ${allPairsFloor(scale, deltaE).toFixed(1)} all-pairs normal vision` +
      ` | ${allPairsFloor(scale, worstSeparation).toFixed(1)} all-pairs worst observer`,
  );
}

function labToRgb(lightness: number, chroma: number, hue: number): RGB | null {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const fy = (lightness + 16) / 116;
  const f = [fy + a / 500, fy, fy - b / 200];
  const white = [0.95047, 1.0, 1.08883];
  const xyz = f.map((value, index) => {
    const cubed = value ** 3;
    return (cubed > 216 / 24389 ? cubed : (116 * value - 16) * (27 / 24389)) * white[index];
  });
  const matrix = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.969266, 1.8760108, 0.041556],
    [0.0556434, -0.2040259, 1.0572252],
  ];
  const linear = matrix.map((row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]);
  if (linear.some((channel) => channel < -0.0005 || channel > 1.0005)) {
    return null;
  }
  const channels = linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  });
  return [channels[0], channels[1], channels[2]];
}

function candidates(surfaces: Array<[string, RGB]>): RGB[] {
  const found = new Map<string, RGB>();
  for (let hue = 0; hue < 360; hue += 5) {
    for (let lightness = 28; lightness <= 88; lightness += 2) {
      for (let chroma = 24; chroma <= 132; chroma += 4) {
        const rgb = labToRgb(lightness, chroma, hue);
        if (rgb === null) {
          continue;
        }
        if (!surfaces.every(([, surface]) => contrastRatio(rgb, surface) >= MIN_CONTRAST)) {
          continue;
        }
        found.set(toHex(rgb), rgb);
      }
    }
  }
  return [...found.values()];
}

/** Farthest-point sampling: each new slot is the one hardest to confuse with
 *  anything already chosen, for the observer who reads it worst. */
function propose(anchor: RGB, pool: RGB[], slots: number): RGB[] {
  const chosen: RGB[] = [anchor];
  while (chosen.length < slots) {
    let best: RGB | null = null;
    let bestScore = -1;
    for (const candidate of pool) {
      const score = chosen.reduce(
        (worst, picked) => Math.min(worst, worstSeparation(candidate, picked)),
        Infinity,
      );
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best === null) {
      break;
    }
    chosen.push(best);
  }
  return chosen;
}

/** Adjacent slots touch in the meter, so the walk that keeps neighbours
 *  farthest apart is the one worth shipping. */
function orderSlots(anchor: RGB, rest: RGB[]): RGB[] {
  const ordered: RGB[] = [anchor];
  const remaining = [...rest];
  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = -1;
    remaining.forEach((candidate, index) => {
      const score = worstSeparation(previous, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    ordered.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  return ordered;
}

function solve(slots: number): void {
  for (const { name, theme } of SCHEMES) {
    const surfaces = surfacesOf(theme);
    const anchor = scaleOf(theme)[0];
    const pool = candidates(surfaces);
    const proposed = propose(anchor, pool, slots);
    const ordered = orderSlots(anchor, proposed.slice(1));
    console.log(`\n${name} — proposal for ${slots} slots (pool ${pool.length}, anchor kept)`);
    ordered.forEach((colour, index) => {
      console.log(`   'rgb-series-${index + 1}': '${colour.join(' ')}', // ${toHex(colour)}`);
    });
    console.log(
      `   adjacent ΔE00 ${adjacentFloor(ordered).toFixed(1)}` +
        ` | all-pairs ${allPairsFloor(ordered, worstSeparation).toFixed(1)} (worst observer)`,
    );
  }
}

const [mode, count] = process.argv.slice(2);
if (mode === 'solve') {
  const slots = Number(count ?? 7);
  if (!Number.isInteger(slots) || slots < 2 || slots > 12) {
    console.error('usage: npm run series -- solve <2-12>');
    process.exit(1);
  }
  solve(slots);
} else {
  SCHEMES.forEach(audit);
}
