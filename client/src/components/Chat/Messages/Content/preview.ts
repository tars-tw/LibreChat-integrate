import { FileSources } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';

type PreviewKind = 'pdf' | 'text' | 'office' | false;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'rb',
  'java',
  'c',
  'cpp',
  'h',
  'go',
  'rs',
  'sh',
  'sql',
  'log',
]);

/** Extensions the server renders as an HTML document; mirrors `officeHtmlBucket` in
 *  `packages/api/src/files/documents/html.ts`. */
const OFFICE_EXTENSIONS = new Set(['docx', 'csv', 'xlsx', 'xls', 'ods', 'pptx', 'potx']);

const OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
]);

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

export function shouldUseSharedFileDownload(shareId?: string, fileId?: string): boolean {
  return !!shareId && !!fileId;
}

export function shouldUseExtractedTextPreview(deliveryPath?: TFile['llmDeliveryPath']): boolean {
  return deliveryPath === 'text';
}

export function isExtractedTextPreviewLoading(
  status: 'pending' | 'ready' | 'failed' | undefined,
  isInitialLoading: boolean,
  isError: boolean,
): boolean {
  return !isError && (isInitialLoading || status === 'pending');
}

/** XML proper and `+xml` suffixes only: OOXML types (`…spreadsheetml.sheet`) contain
 *  "xml" too, but they are zip archives. */
const XML_MIME = /^application\/xml\b|\+xml\b/;

/** A known office extension wins; MIME only classifies extensionless files, as on the server. */
function isOfficePreview(fileName: string, mime?: string): boolean {
  const extension = getFileExtension(fileName);
  if (extension) {
    return OFFICE_EXTENSIONS.has(extension);
  }
  return !!mime && OFFICE_MIME_TYPES.has(mime.split(';')[0].trim().toLowerCase());
}

function getPreviewKindByMime(mime?: string): PreviewKind {
  if (!mime) {
    return false;
  }
  if (mime.includes('pdf')) {
    return 'pdf';
  }
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    XML_MIME.test(mime) ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('yaml') ||
    mime.includes('csv')
  ) {
    return 'text';
  }
  return false;
}

function getPreviewKindByExtension(filename: string): PreviewKind {
  const extension = getFileExtension(filename);
  if (extension === 'pdf') {
    return 'pdf';
  }
  return TEXT_EXTENSIONS.has(extension) ? 'text' : false;
}

export function getPreviewKind(
  fileName: string,
  fileType?: string,
  fileSource?: string,
): PreviewKind {
  if (fileSource === FileSources.text) {
    return 'text';
  }
  if (isOfficePreview(fileName, fileType)) {
    return 'office';
  }
  return getPreviewKindByMime(fileType) || getPreviewKindByExtension(fileName);
}
