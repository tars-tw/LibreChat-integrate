import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const traceRoot = join(__dirname, '..');
/** Every source under the trace panel, `Sections/` included; the specs themselves are skipped. */
const sources = readdirSync(traceRoot, { recursive: true, encoding: 'utf8' }).filter(
  (file) => /\.tsx?$/.test(file) && !file.split(/[\\/]/).includes('__tests__'),
);

/** Tailwind's own palettes; the trace takes its colors from the theme's roles instead. */
const directPalette =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;
const hexColor = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/i;
/** A hand-written dark value; the theme's roles already switch with it. */
const darkColor = /\bdark:(?:bg|text|border|ring)-/;

describe('audit trace color guardrail', () => {
  it.each(sources)('%s uses semantic color roles only', (file) => {
    const contents = readFileSync(join(traceRoot, file), 'utf8');

    expect(contents).not.toMatch(directPalette);
    expect(contents).not.toMatch(hexColor);
    expect(contents).not.toMatch(darkColor);
  });
});
