import path from 'path';
import * as fs from 'fs';
import { parseDocumentBuffer, canParseDocumentMimeType } from './crud';
import { buildMinimalPdfBuffer, mockPdfjs } from './pdf.helper';

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => mockPdfjs());

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';

describe('parseDocumentBuffer() & canParseDocumentMimeType()', () => {
  test('canParseDocumentMimeType recognizes handled formats and rejects others', () => {
    expect(canParseDocumentMimeType('application/pdf')).toBe(true);
    expect(
      canParseDocumentMimeType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
    expect(canParseDocumentMimeType('application/msword')).toBe(true);
    expect(canParseDocumentMimeType('application/vnd.ms-excel')).toBe(true);
    expect(
      canParseDocumentMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(true);
    expect(canParseDocumentMimeType('application/vnd.oasis.opendocument.text')).toBe(true);
    expect(canParseDocumentMimeType('application/vnd.oasis.opendocument.spreadsheet')).toBe(true);
    expect(canParseDocumentMimeType(ODP_MIME)).toBe(true);
    expect(canParseDocumentMimeType(PPTX_MIME)).toBe(true);

    expect(canParseDocumentMimeType('application/zip')).toBe(false);
    expect(canParseDocumentMimeType('image/png')).toBe(false);
    expect(canParseDocumentMimeType('text/plain')).toBe(false);
  });

  test('parseDocumentBuffer() extracts text from a real PDF buffer', async () => {
    const buffer = buildMinimalPdfBuffer('Hello vLLM PDF');
    const result = await parseDocumentBuffer({
      buffer,
      mimetype: 'application/pdf',
      originalname: 'report.pdf',
    });
    expect(result.filename).toBe('report.pdf');
    expect(result.filepath).toBe('document_parser');
    expect(result.text.trim()).toContain('Hello vLLM PDF');
  });

  test.each([
    [
      'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'This is a sample DOCX file.',
    ],
    ['sample.doc', 'application/msword', 'Second paragraph with ASCII.'],
    [
      'sample.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Data,on,first,sheet',
    ],
    ['sample.xls', 'application/vnd.ms-excel', 'Data,on,first,sheet'],
    ['sample.ods', 'application/vnd.oasis.opendocument.spreadsheet', 'Data,on,first,sheet'],
    ['sample.odt', 'application/vnd.oasis.opendocument.text', 'sample ODT'],
    ['sample.odp', ODP_MIME, 'Slide 1:'],
    ['sample.pptx', PPTX_MIME, 'Slide 1:'],
  ])('parseDocumentBuffer() extracts text from %s', async (fixture, mimetype, expected) => {
    const buffer = await fs.promises.readFile(path.join(__dirname, fixture));
    const result = await parseDocumentBuffer({ buffer, mimetype, originalname: fixture });
    expect(result.text).toContain(expected);
  });

  test('parseDocumentBuffer() rejects buffers exceeding the 15MB limit', async () => {
    const oversized = Buffer.alloc(16 * 1024 * 1024);
    await expect(
      parseDocumentBuffer({
        buffer: oversized,
        mimetype: 'application/pdf',
        originalname: 'huge.pdf',
      }),
    ).rejects.toThrow(/exceeds the 15MB document parser limit/);
  });

  test('parseDocumentBuffer() throws for unhandled MIME types and empty documents', async () => {
    await expect(
      parseDocumentBuffer({
        buffer: Buffer.from('binary'),
        mimetype: 'application/zip',
        originalname: 'archive.zip',
      }),
    ).rejects.toThrow('Unsupported file type in document parser: application/zip');

    const emptyPdf = buildMinimalPdfBuffer('');
    await expect(
      parseDocumentBuffer({
        buffer: emptyPdf,
        mimetype: 'application/pdf',
        originalname: 'blank.pdf',
      }),
    ).rejects.toThrow('No text found in document');
  });

  test('parseDocumentBuffer() destroys the pdfjs task on success and failure, tolerating teardown errors', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const getDocumentMock = jest.mocked(pdfjs.getDocument);

    const loadingDestroy = jest.fn(async () => undefined);
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.reject(new Error('corrupt pdf header')),
      destroy: loadingDestroy,
    } as never);

    await expect(
      parseDocumentBuffer({
        buffer: Buffer.from('%PDF-broken'),
        mimetype: 'application/pdf',
        originalname: 'broken.pdf',
      }),
    ).rejects.toThrow('corrupt pdf header');
    expect(loadingDestroy).toHaveBeenCalledTimes(1);

    const failingDestroy = jest.fn(async () => {
      throw new Error('teardown error');
    });
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ type: 'beginMarkedContent' }, { str: 'Recovered text' }],
          }),
        }),
      }),
      destroy: failingDestroy,
    } as never);

    const result = await parseDocumentBuffer({
      buffer: buildMinimalPdfBuffer('ignored'),
      mimetype: 'application/pdf',
      originalname: 'tolerant.pdf',
    });
    expect(failingDestroy).toHaveBeenCalledTimes(1);
    expect(result.text.trim()).toBe('Recovered text');
  });
});
