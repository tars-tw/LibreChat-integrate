import { logger } from '@librechat/data-schemas';
import { FileSources } from 'librechat-data-provider';
import type { Readable } from 'stream';
import { hasOfficeHtmlPath, renderOfficeHtml, MAX_TEXT_EXTRACT_BYTES } from './code/extract';

/** Sources whose strategy streams the stored bytes as `getDownloadStream(req, filepath)`. */
const STREAMED_SOURCES: ReadonlySet<string> = new Set([
  FileSources.local,
  FileSources.firebase,
  FileSources.azure_blob,
  FileSources.s3,
  FileSources.cloudfront,
]);

export interface OfficePreviewFile {
  filename?: string;
  type?: string;
  bytes?: number;
  source?: string;
}

export interface RenderedOfficePreview {
  text: string;
  textFormat: 'html';
}

/**
 * Whether an upload with no stored preview text can be rendered on demand: an office or
 * spreadsheet file, held in byte storage, within the inline-preview size ceiling.
 */
export function canRenderOfficePreview(
  file: OfficePreviewFile,
  maxBytes: number = MAX_TEXT_EXTRACT_BYTES,
): boolean {
  if (!file.filename || !STREAMED_SOURCES.has(file.source ?? FileSources.local)) {
    return false;
  }
  if (file.bytes != null && file.bytes > maxBytes) {
    return false;
  }
  return hasOfficeHtmlPath(file.filename, file.type ?? '');
}

/** Buffers a stream, giving up (and closing it) once it passes `maxBytes`. */
async function readCapped(stream: Readable, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Renders an uploaded office file as the same sanitized HTML document code-execution
 * artifacts get, for the file preview dialog. Uploads delivered to the model as `none` or
 * `provider` never store a preview, so without this the dialog decoded the raw zip bytes as
 * text. Nothing is persisted: the stored `text` field feeds the model when a file is
 * delivered as text, and must stay the extracted text.
 *
 * Returns `null` when the file is not renderable, too large, unreadable, or fails to render.
 */
export async function renderOfficePreview(
  file: OfficePreviewFile,
  openStream: () => Promise<Readable>,
  maxBytes: number = MAX_TEXT_EXTRACT_BYTES,
): Promise<RenderedOfficePreview | null> {
  if (!canRenderOfficePreview(file, maxBytes)) {
    return null;
  }
  const filename = file.filename ?? '';
  try {
    const buffer = await readCapped(await openStream(), maxBytes);
    if (!buffer) {
      return null;
    }
    const html = await renderOfficeHtml(buffer, filename, file.type ?? '');
    return html == null ? null : { text: html, textFormat: 'html' };
  } catch (error) {
    logger.warn(
      `[renderOfficePreview] Could not read "${filename}" for preview: ${(error as Error).message}`,
    );
    return null;
  }
}
