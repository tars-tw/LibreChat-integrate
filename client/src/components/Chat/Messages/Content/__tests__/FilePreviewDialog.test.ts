import { FileSources } from 'librechat-data-provider';
import {
  getPreviewKind,
  isExtractedTextPreviewLoading,
  shouldUseExtractedTextPreview,
  shouldUseSharedFileDownload,
} from '../preview';
import { getDownloadFilename } from '~/utils/downloadFile';

describe('FilePreviewDialog text-source behavior', () => {
  it('previews extracted PDF content as text', () => {
    expect(getPreviewKind('report.pdf', 'application/pdf', FileSources.text)).toBe('text');
  });

  it('downloads extracted content with a text extension', () => {
    expect(getDownloadFilename('report.pdf', 'file-1', FileSources.text)).toBe('report.pdf.txt');
    expect(getDownloadFilename('notes.txt', 'file-2', FileSources.text)).toBe('notes.txt');
  });

  it('preserves the original behavior for stored files', () => {
    expect(getPreviewKind('report.pdf', 'application/pdf', FileSources.local)).toBe('pdf');
    expect(getDownloadFilename('report.pdf', 'file-3', FileSources.local)).toBe('report.pdf');
  });

  it('previews office files as server-rendered documents, not decoded bytes', () => {
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(getPreviewKind('品質會議.xlsx', xlsx, FileSources.local)).toBe('office');
    expect(getPreviewKind('legacy.xls', 'application/vnd.ms-excel')).toBe('office');
    expect(getPreviewKind('export.csv', 'text/csv')).toBe('office');
    expect(getPreviewKind('report.docx', undefined)).toBe('office');
    expect(getPreviewKind('workbook', xlsx)).toBe('office');
  });

  it('keeps a known non-office extension ahead of an office MIME, as the server does', () => {
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(getPreviewKind('data.bin', xlsx)).toBe(false);
    expect(getPreviewKind('data.json', xlsx)).toBe('text');
  });

  it('treats only real XML MIME types as text', () => {
    const dotx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';
    expect(getPreviewKind('letter.dotx', dotx)).toBe(false);
    expect(getPreviewKind('feed', 'application/rss+xml')).toBe('text');
    expect(getPreviewKind('config', 'application/xml')).toBe('text');
  });

  it('uses stored extracted text when the delivery path is text', () => {
    expect(shouldUseExtractedTextPreview('text')).toBe(true);
    expect(shouldUseExtractedTextPreview('provider')).toBe(false);
    expect(shouldUseExtractedTextPreview(undefined)).toBe(false);
  });

  it('stops showing a pending preview as loading when polling fails', () => {
    expect(isExtractedTextPreviewLoading('pending', false, true)).toBe(false);
    expect(isExtractedTextPreviewLoading('pending', false, false)).toBe(true);
  });

  it('routes any identified file through the share boundary in a shared view', () => {
    expect(shouldUseSharedFileDownload('share-1', 'file-1')).toBe(true);
    expect(shouldUseSharedFileDownload('share-1', undefined)).toBe(false);
    expect(shouldUseSharedFileDownload(undefined, 'file-1')).toBe(false);
  });
});
