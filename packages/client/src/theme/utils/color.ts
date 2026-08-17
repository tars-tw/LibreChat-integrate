export type RGB = readonly [number, number, number];

/** The three dichromacies the categorical scale is checked against. */
export type Dichromacy = 'protan' | 'deutan' | 'tritan';

type Matrix = readonly [RGB, RGB, RGB];

type Lab = readonly [number, number, number];

const RGB_TO_XYZ: Matrix = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

const D65: RGB = [0.95047, 1.0, 1.08883];

/** Viénot, Brettel & Mollon (1999), applied in linear light. */
const DICHROMACY: Record<Dichromacy, Matrix> = {
  protan: [
    [0.11238, 0.88762, 0.0],
    [0.11238, 0.88762, 0.0],
    [0.00401, -0.00401, 1.0],
  ],
  deutan: [
    [0.29275, 0.70725, 0.0],
    [0.29275, 0.70725, 0.0],
    [-0.02234, 0.02234, 1.0],
  ],
  tritan: [
    [1.0, 0.14461, -0.14461],
    [0.0, 1.0, 0.0],
    [0.0, 0.85924, 0.14076],
  ],
};

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

const rgbPattern = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;

/** Reads a theme token — tokens carry space-separated channels, not hex. */
export function parseRgb(token: string): RGB {
  const match = token.match(rgbPattern);
  if (match === null) {
    throw new Error(`not an "R G B" colour token: ${token}`);
  }
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) {
    throw new Error(`channel out of range: ${token}`);
  }
  return [channels[0], channels[1], channels[2]];
}

export function toHex(rgb: RGB): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toGamma(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const channel = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(channel * 255);
}

function apply(matrix: Matrix, vector: RGB): RGB {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function linearise(rgb: RGB): RGB {
  return [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])];
}

function toLab(rgb: RGB): Lab {
  const xyz = apply(RGB_TO_XYZ, linearise(rgb));
  const [fx, fy, fz] = xyz.map((component, index) => {
    const ratio = component / D65[index];
    return ratio > EPSILON ? Math.cbrt(ratio) : (KAPPA * ratio + 16) / 116;
  });
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab hue angle in degrees. Two colours share an identity when they share a
 *  hue, whatever the surface has done to their lightness. */
export function hueAngle(rgb: RGB): number {
  const [, a, b] = toLab(rgb);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = linearise(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RGB, b: RGB): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function simulate(rgb: RGB, kind: Dichromacy): RGB {
  const seen = apply(DICHROMACY[kind], linearise(rgb));
  return [toGamma(seen[0]), toGamma(seen[1]), toGamma(seen[2])];
}

/** Hue is circular, so both halves of the formula have to pick the short way
 *  round — and neither is defined when either colour is achromatic. */
function hueDifference(first: number, second: number, achromatic: boolean): number {
  if (achromatic) {
    return 0;
  }
  const raw = second - first;
  if (Math.abs(raw) <= 180) {
    return raw;
  }
  return raw > 0 ? raw - 360 : raw + 360;
}

function meanHue(first: number, second: number, achromatic: boolean): number {
  const sum = first + second;
  if (achromatic) {
    return sum;
  }
  if (Math.abs(first - second) <= 180) {
    return sum / 2;
  }
  return sum < 360 ? (sum + 360) / 2 : (sum - 360) / 2;
}

/**
 * CIEDE2000. Plain Euclidean Lab distance overstates separation in the blues
 * and understates it in the neutrals, which is exactly where a categorical
 * scale is decided, so the full formula is worth its length here.
 */
export function deltaE(first: RGB, second: RGB): number {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  const angle = (a: number, b: number): number =>
    a === 0 && b === 0 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const h1p = angle(a1p, b1);
  const h2p = angle(a2p, b2);

  const deltaL = l2 - l1;
  const deltaC = c2p - c1p;

  const achromatic = c1p * c2p === 0;
  const deltaHue = hueDifference(h1p, h2p, achromatic);
  const deltaH = 2 * Math.sqrt(c1p * c2p) * Math.sin((deltaHue * Math.PI) / 360);

  const meanL = (l1 + l2) / 2;
  const meanCp = (c1p + c2p) / 2;
  const meanH = meanHue(h1p, h2p, achromatic);

  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const t =
    1 -
    0.17 * Math.cos(radians(meanH - 30)) +
    0.24 * Math.cos(radians(2 * meanH)) +
    0.32 * Math.cos(radians(3 * meanH + 6)) -
    0.2 * Math.cos(radians(4 * meanH - 63));

  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt =
    -2 *
    Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7)) *
    Math.sin(radians(60 * Math.exp(-(((meanH - 275) / 25) ** 2))));

  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaH / sh),
  );
}

/**
 * Separation as the least-favoured observer sees it. Two marks are only as
 * distinguishable as they are for whoever reads them worst, so the scale is
 * scored on the minimum across normal vision and each dichromacy rather than
 * on the normal-vision figure alone.
 */
export function worstSeparation(first: RGB, second: RGB): number {
  const kinds: Dichromacy[] = ['protan', 'deutan', 'tritan'];
  return kinds.reduce(
    (worst, kind) => Math.min(worst, deltaE(simulate(first, kind), simulate(second, kind))),
    deltaE(first, second),
  );
}
