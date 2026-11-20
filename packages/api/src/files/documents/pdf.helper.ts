/** A one-page PDF whose content stream shows `text` through a single `Tj` operator. */
export function buildMinimalPdfBuffer(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

/**
 * Module factory for `pdfjs-dist/legacy/build/pdf.mjs`, whose ESM `import.meta.url` Jest cannot
 * run in CJS mode: `getDocument` reads the literal `(...) Tj` operators of the buffer as one page.
 * The `mock` prefix is what lets a hoisted `jest.mock` factory call it.
 */
export function mockPdfjs() {
  return {
    getDocument: jest.fn(({ data }: { data: Uint8Array }) => {
      const raw = Buffer.from(data).toString('latin1');
      const items = [...raw.matchAll(/\(([^)]*)\)\s*Tj/g)].map(([, str]) => ({
        str: str.replace(/\\([()\\])/g, '$1'),
      }));
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items }),
          }),
        }),
        destroy: jest.fn(async () => undefined),
      };
    }),
  };
}
