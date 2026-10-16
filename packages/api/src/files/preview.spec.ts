import path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { FileSources } from 'librechat-data-provider';
import { canRenderOfficePreview, renderOfficePreview } from './preview';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const workbook = fs.readFileSync(path.join(__dirname, 'documents', 'sample.xlsx'));

const upload = {
  filename: 'sample.xlsx',
  type: XLSX_MIME,
  bytes: workbook.length,
  source: FileSources.local,
};

describe('canRenderOfficePreview', () => {
  it('accepts a stored spreadsheet within the size ceiling', () => {
    expect(canRenderOfficePreview(upload)).toBe(true);
    expect(canRenderOfficePreview({ ...upload, source: undefined })).toBe(true);
  });

  it('rejects sources without a byte stream', () => {
    expect(canRenderOfficePreview({ ...upload, source: FileSources.text })).toBe(false);
    expect(canRenderOfficePreview({ ...upload, source: FileSources.openai })).toBe(false);
    expect(canRenderOfficePreview({ ...upload, source: FileSources.execute_code })).toBe(false);
  });

  it('rejects non-office files and oversized ones', () => {
    expect(canRenderOfficePreview({ ...upload, filename: 'notes.txt', type: 'text/plain' })).toBe(
      false,
    );
    expect(canRenderOfficePreview(upload, workbook.length - 1)).toBe(false);
  });
});

describe('renderOfficePreview', () => {
  it('renders the stored bytes as an HTML document', async () => {
    const openStream = jest.fn(async () => Readable.from([workbook]));
    const preview = await renderOfficePreview(upload, openStream);
    expect(openStream).toHaveBeenCalledTimes(1);
    expect(preview?.textFormat).toBe('html');
    expect(preview?.text).toMatch(/^<!DOCTYPE html>/);
    expect(preview?.text).toContain('Sheet One');
  });

  it('never opens storage for a file it cannot render', async () => {
    const openStream = jest.fn(async () => Readable.from([workbook]));
    await expect(
      renderOfficePreview({ ...upload, source: FileSources.text }, openStream),
    ).resolves.toBeNull();
    expect(openStream).not.toHaveBeenCalled();
  });

  it('stops reading once the stream outgrows the ceiling', async () => {
    const half = Math.ceil(workbook.length / 2);
    const stream = Readable.from([workbook.subarray(0, half), workbook.subarray(half)]);
    const destroy = jest.spyOn(stream, 'destroy');
    const preview = await renderOfficePreview(
      { ...upload, bytes: undefined },
      async () => stream,
      half,
    );
    expect(preview).toBeNull();
    expect(destroy).toHaveBeenCalled();
  });

  it('returns null when storage fails', async () => {
    const preview = await renderOfficePreview(upload, async () => {
      throw new Error('ENOENT');
    });
    expect(preview).toBeNull();
  });
});
