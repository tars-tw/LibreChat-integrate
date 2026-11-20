import path from 'path';
import * as fs from 'fs';
import { Types } from 'mongoose';
import { Providers } from '@librechat/agents';
import { logger } from '@librechat/data-schemas';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import { buildMinimalPdfBuffer, mockPdfjs } from '~/files/documents/pdf.helper';
import { ContentFilterError } from '~/middleware/contentFilter';
import { UninspectableFileError } from '~/protection/files';
import { encodeAndFormatDocuments } from './document';

jest.mock('~/files/validation', () => ({
  validatePdf: jest.fn(),
  validateBedrockDocument: jest.fn(),
}));

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => mockPdfjs());

jest.mock('./utils', () => ({
  getFileStream: jest.fn(),
  getConfiguredFileSizeLimit: jest.fn(),
  isAttachmentObjectNotFoundError: jest.fn(() => false),
}));

import {
  getFileStream,
  getConfiguredFileSizeLimit,
  isAttachmentObjectNotFoundError,
} from './utils';
import { validatePdf } from '~/files/validation';

const mockedValidatePdf = validatePdf as jest.MockedFunction<typeof validatePdf>;
const mockedGetFileStream = getFileStream as jest.MockedFunction<typeof getFileStream>;
const mockedIsNotFound = isAttachmentObjectNotFoundError as jest.MockedFunction<
  typeof isAttachmentObjectNotFoundError
>;
const mockedGetConfiguredFileSizeLimit = getConfiguredFileSizeLimit as jest.MockedFunction<
  typeof getConfiguredFileSizeLimit
>;

describe('encodeAndFormatDocuments - supportsFileParts: false text fallback', () => {
  const mockStrategyFunctions = jest.fn();

  const createFile = (overrides: Partial<IMongoFile> = {}): IMongoFile =>
    ({
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      file_id: new Types.ObjectId().toString(),
      filename: 'report.pdf',
      type: 'application/pdf',
      bytes: 2048,
      object: 'file',
      usage: 0,
      source: 'local',
      filepath: '/uploads/report.pdf',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as unknown as IMongoFile;

  const createVllmRequest = (
    extraFileConfig: Record<string, unknown> = {},
    extraConfig: Record<string, unknown> = {},
    body: Record<string, unknown> = {},
  ): ServerRequest =>
    ({
      body,
      config: {
        fileConfig: {
          endpoints: {
            vLLM: {
              supportsFileParts: false,
            },
          },
          ...extraFileConfig,
        },
        ...extraConfig,
      },
    }) as unknown as ServerRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfiguredFileSizeLimit.mockReturnValue(undefined);
    mockedValidatePdf.mockResolvedValue({ isValid: true });
    mockedIsNotFound.mockReturnValue(false);
  });

  it('extracts PDF text into a text part instead of emitting a file part for vLLM', async () => {
    const req = createVllmRequest();
    const file = createFile();
    const pdfContent = buildMinimalPdfBuffer('Quarterly revenue grew 18 percent').toString(
      'base64',
    );
    mockedGetFileStream.mockResolvedValue({ file, content: pdfContent, metadata: file });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM', model: 'gemma-4-31B' },
      mockStrategyFunctions,
    );

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('File: "report.pdf"\n\nQuarterly revenue grew 18 percent'),
    });
    expect(result.files).toHaveLength(1);
    /* OpenAI's 10MB file-part limit governs bytes the provider receives; vLLM receives text. */
    expect(mockedValidatePdf).not.toHaveBeenCalled();
  });

  it('fails the turn when a stored document exceeds the configured size limit', async () => {
    const req = createVllmRequest();
    const file = createFile();
    mockedGetConfiguredFileSizeLimit.mockReturnValue(16);
    mockedGetFileStream.mockResolvedValue({
      file,
      content: buildMinimalPdfBuffer('Too large for the configured limit').toString('base64'),
      metadata: file,
    });

    await expect(
      encodeAndFormatDocuments(
        req,
        [file],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      ),
    ).rejects.toThrow(/exceeds the configured limit/);
  });

  it('rethrows a missing stored object and skips any other storage failure', async () => {
    const req = createVllmRequest();
    const missing = createFile({ filename: 'missing.pdf' });
    const unreadable = createFile({ filename: 'unreadable.pdf' });
    const healthy = createFile({ filename: 'healthy.pdf' });
    const notFound = new Error('object not found');
    mockedIsNotFound.mockImplementation((error) => error === notFound);

    mockedGetFileStream.mockRejectedValueOnce(notFound);
    await expect(
      encodeAndFormatDocuments(
        req,
        [missing],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      ),
    ).rejects.toBe(notFound);

    mockedGetFileStream.mockRejectedValueOnce(new Error('storage timeout')).mockResolvedValueOnce({
      file: healthy,
      content: buildMinimalPdfBuffer('Healthy sibling').toString('base64'),
      metadata: healthy,
    });
    const result = await encodeAndFormatDocuments(
      req,
      [unreadable, healthy],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );
    expect(result.documents).toEqual([
      { type: 'text', text: expect.stringContaining('Healthy sibling') },
    ]);
  });

  it('also falls back to text instead of input_file when useResponsesApi is true', async () => {
    const req = createVllmRequest();
    const file = createFile();
    const pdfContent = buildMinimalPdfBuffer('Responses API fallback').toString('base64');
    mockedGetFileStream.mockResolvedValue({ file, content: pdfContent, metadata: file });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM', useResponsesApi: true },
      mockStrategyFunctions,
    );

    expect(result.documents).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Responses API fallback'),
      },
    ]);
  });

  it('extracts text from DOCX and natively textual files when supportsFileParts is false', async () => {
    const req = createVllmRequest();
    const docxBytes = await fs.promises.readFile(path.join(__dirname, '../documents/sample.docx'));
    const docxFile = createFile({
      filename: 'sample.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filepath: '/uploads/sample.docx',
    });
    const jsonFile = createFile({
      filename: 'config.json',
      type: 'application/json',
      filepath: '/uploads/config.json',
    });

    mockedGetFileStream
      .mockResolvedValueOnce({
        file: docxFile,
        content: docxBytes.toString('base64'),
        metadata: docxFile,
      })
      .mockResolvedValueOnce({
        file: jsonFile,
        content: Buffer.from('{"ok":true}').toString('base64'),
        metadata: jsonFile,
      });

    const result = await encodeAndFormatDocuments(
      req,
      [docxFile, jsonFile],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(result.documents).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('File: "sample.docx"\n\nThis is a sample DOCX file.'),
      },
      {
        type: 'text',
        text: 'File: "config.json"\n\n{"ok":true}',
      },
    ]);
    expect(result.files).toHaveLength(2);
  });

  it('reuses pre-extracted plain text without streaming bytes from storage', async () => {
    const req = createVllmRequest();
    const file = createFile({
      text: 'Cached PDF text from prior extraction',
      textFormat: 'text',
    });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(mockedGetFileStream).not.toHaveBeenCalled();
    expect(result.documents).toEqual([
      {
        type: 'text',
        text: 'File: "report.pdf"\n\nCached PDF text from prior extraction',
      },
    ]);
    expect(result.files).toHaveLength(1);
  });

  it('does not reuse HTML preview textFormat and extracts from the stored document buffer instead', async () => {
    const req = createVllmRequest();
    const docxBytes = await fs.promises.readFile(path.join(__dirname, '../documents/sample.docx'));
    const file = createFile({
      filename: 'sample.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text: '<html><body>preview only</body></html>',
      textFormat: 'html',
    });
    mockedGetFileStream.mockResolvedValue({
      file,
      content: docxBytes.toString('base64'),
      metadata: file,
    });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(mockedGetFileStream).toHaveBeenCalledTimes(1);
    expect(result.documents[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('This is a sample DOCX file.'),
    });
    expect(JSON.stringify(result.documents[0])).not.toContain('preview only');
  });

  it('skips non-extractable binary attachments without contacting storage', async () => {
    const req = createVllmRequest();
    const zipFile = createFile({ filename: 'bundle.zip', type: 'application/zip' });

    const result = await encodeAndFormatDocuments(
      req,
      [zipFile],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(mockedGetFileStream).not.toHaveBeenCalled();
    expect(result.documents).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('skips a document with no stored object or only whitespace text without failing the turn', async () => {
    const req = createVllmRequest();
    const unstored = createFile({ filename: 'unstored.pdf', filepath: undefined });
    const blank = createFile({ filename: 'blank.txt', type: 'text/plain' });
    mockedGetFileStream.mockResolvedValueOnce(null).mockResolvedValueOnce({
      file: blank,
      content: Buffer.from(' \n\t ').toString('base64'),
      metadata: blank,
    });

    const result = await encodeAndFormatDocuments(
      req,
      [unstored, blank],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(mockedGetFileStream).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ documents: [], files: [] });
  });

  it('skips scanned PDFs with no extractable text instead of emitting a file block', async () => {
    const req = createVllmRequest();
    const file = createFile({ filename: 'scan.pdf' });
    const emptyPdf = buildMinimalPdfBuffer('').toString('base64');
    mockedGetFileStream.mockResolvedValue({ file, content: emptyPdf, metadata: file });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(result.documents).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('truncates extracted fallback text to fileContextCharLimit and fileTokenLimit', async () => {
    const charReq = createVllmRequest({ fileContextCharLimit: 20 }, {}, { fileTokenLimit: 1000 });
    const file = createFile({
      filename: 'long.txt',
      type: 'text/plain',
    });
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz').toString('base64');
    mockedGetFileStream.mockResolvedValueOnce({ file, content, metadata: file });

    const charResult = await encodeAndFormatDocuments(
      charReq,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(charResult.documents).toEqual([
      {
        type: 'text',
        text: 'File: "long.txt"\n\n0123456789abcdefghij',
      },
    ]);

    const longSentence = Array.from({ length: 80 }, (_, idx) => `word${idx}`).join(' ');
    const tokenReq = createVllmRequest({}, {}, { fileTokenLimit: 10 });
    mockedGetFileStream.mockResolvedValueOnce({
      file,
      content: Buffer.from(longSentence).toString('base64'),
      metadata: file,
    });

    const tokenResult = await encodeAndFormatDocuments(
      tokenReq,
      [file],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(tokenResult.documents).toHaveLength(1);
    const tokenBlock = tokenResult.documents[0] as { type: string; text: string };
    expect(tokenBlock.type).toBe('text');
    expect(tokenBlock.text.startsWith('File: "long.txt"\n\nword0')).toBe(true);
    expect(tokenBlock.text.length).toBeLessThan(longSentence.length);
  });

  it('skips corrupt documents during fallback extraction without failing sibling attachments', async () => {
    const req = createVllmRequest();
    const corruptDocx = createFile({
      filename: 'broken.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filepath: '/uploads/broken.docx',
    });
    const validPdf = createFile({ filename: 'good.pdf' });

    mockedGetFileStream
      .mockResolvedValueOnce({
        file: corruptDocx,
        content: Buffer.from('not-a-valid-zip-archive').toString('base64'),
        metadata: corruptDocx,
      })
      .mockResolvedValueOnce({
        file: validPdf,
        content: buildMinimalPdfBuffer('Sibling PDF succeeded').toString('base64'),
        metadata: validPdf,
      });

    const result = await encodeAndFormatDocuments(
      req,
      [corruptDocx, validPdf],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );

    expect(result.documents).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('File: "good.pdf"\n\nSibling PDF succeeded'),
      },
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe('good.pdf');
  });

  it('enforces content protection policies on newly extracted, pre-extracted, and fail-closed unextractable PDFs', async () => {
    const filters = {
      files: {
        pii: {
          fields: ['extracted_text'],
          uninspectable: 'block',
          starterPatterns: [],
          customPatterns: [
            {
              id: 'secret-token',
              label: 'Secret token',
              regex: 'TOP-SECRET-KEY',
              action: 'block',
            },
          ],
        },
      },
    };
    const req = createVllmRequest({}, { filters });
    const sensitiveFile = createFile({ filename: 'secret.pdf' });
    mockedGetFileStream.mockResolvedValueOnce({
      file: sensitiveFile,
      content: buildMinimalPdfBuffer('Contains TOP-SECRET-KEY inside').toString('base64'),
      metadata: sensitiveFile,
    });

    await expect(
      encodeAndFormatDocuments(
        req,
        [sensitiveFile],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      ),
    ).rejects.toThrow(ContentFilterError);

    const preExtractedSecret = createFile({
      filename: 'cached-secret.pdf',
      text: 'Cached TOP-SECRET-KEY payload',
      textFormat: 'text',
    });
    await expect(
      encodeAndFormatDocuments(
        req,
        [preExtractedSecret],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      ),
    ).rejects.toThrow(ContentFilterError);

    const scanFile = createFile({ filename: 'scan.pdf' });
    mockedGetFileStream.mockResolvedValueOnce({
      file: scanFile,
      content: buildMinimalPdfBuffer('').toString('base64'),
      metadata: scanFile,
    });

    await expect(
      encodeAndFormatDocuments(
        req,
        [scanFile],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      ),
    ).rejects.toThrow(UninspectableFileError);
  });

  it('applies text fallback case-insensitively for mixed-case OpenAI providers even with useResponsesApi', async () => {
    const req = createVllmRequest();
    const file = createFile();
    mockedGetFileStream.mockResolvedValueOnce({
      file,
      content: buildMinimalPdfBuffer('Case insensitive OpenAI fallback').toString('base64'),
      metadata: file,
    });

    const result = await encodeAndFormatDocuments(
      req,
      [file],
      { provider: 'OpenAI' as Providers, endpoint: 'vLLM', useResponsesApi: true },
      mockStrategyFunctions,
    );

    expect(result.documents).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('Case insensitive OpenAI fallback'),
      },
    ]);
  });

  it('logs original filename for traceability by default and redacts it under content protection', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      const normalReq = createVllmRequest();
      const normalFile = createFile({
        file_id: 'file-trace-1',
        filename: 'quarterly-report-2026.pdf',
      });
      mockedGetFileStream.mockResolvedValueOnce({
        file: normalFile,
        content: buildMinimalPdfBuffer('Public quarterly summary').toString('base64'),
        metadata: normalFile,
      });

      await encodeAndFormatDocuments(
        normalReq,
        [normalFile],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      );

      const normalLogs = infoSpy.mock.calls.map(([msg]) => String(msg));
      expect(normalLogs).toEqual([
        expect.stringContaining('Sent "quarterly-report-2026.pdf" as text'),
      ]);

      infoSpy.mockClear();

      const filters = {
        files: {
          pii: {
            fields: ['extracted_text'],
            starterPatterns: [],
            customPatterns: [
              {
                id: 'secret-token',
                label: 'Secret token',
                regex: 'NEVER-MATCHES',
                action: 'block',
              },
            ],
          },
        },
      };
      const protectedReq = createVllmRequest({}, { filters });
      const protectedFile = createFile({
        file_id: 'file-safe-log-1',
        filename: 'confidential-salary-2026.pdf',
      });
      mockedGetFileStream.mockResolvedValueOnce({
        file: protectedFile,
        content: buildMinimalPdfBuffer('Benign financial overview').toString('base64'),
        metadata: protectedFile,
      });

      await encodeAndFormatDocuments(
        protectedReq,
        [protectedFile],
        { provider: Providers.OPENAI, endpoint: 'vLLM' },
        mockStrategyFunctions,
      );

      const protectedLogs = infoSpy.mock.calls.map(([msg]) => String(msg));
      expect(protectedLogs).toEqual([
        expect.stringContaining('Sent file_id=file-safe-log-1 as text'),
      ]);
      expect(protectedLogs.join('\n')).not.toContain('confidential-salary-2026.pdf');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('leaves Anthropic, Google, standard OpenAI and unconfigured deployments untouched', async () => {
    const req = createVllmRequest();
    const pdfFile = createFile();
    const pdfContent = buildMinimalPdfBuffer('Native PDF').toString('base64');

    mockedGetFileStream.mockResolvedValue({
      file: pdfFile,
      content: pdfContent,
      metadata: pdfFile,
    });

    const unconfiguredResult = await encodeAndFormatDocuments(
      { body: {}, config: {} } as unknown as ServerRequest,
      [pdfFile],
      { provider: Providers.OPENAI, endpoint: 'vLLM' },
      mockStrategyFunctions,
    );
    expect(unconfiguredResult.documents[0]).toMatchObject({ type: 'file' });

    const openAiResult = await encodeAndFormatDocuments(
      req,
      [pdfFile],
      { provider: Providers.OPENAI, endpoint: 'openAI' },
      mockStrategyFunctions,
    );
    expect(openAiResult.documents[0]).toMatchObject({
      type: 'file',
      file: { filename: 'report.pdf' },
    });

    const globalOffReq = createVllmRequest({ supportsFileParts: false });
    const googleResult = await encodeAndFormatDocuments(
      globalOffReq,
      [pdfFile],
      { provider: Providers.GOOGLE, endpoint: 'google' },
      mockStrategyFunctions,
    );
    expect(googleResult.documents[0]).toMatchObject({
      type: 'media',
      mimeType: 'application/pdf',
    });

    const anthropicResult = await encodeAndFormatDocuments(
      globalOffReq,
      [pdfFile],
      { provider: Providers.ANTHROPIC, endpoint: 'anthropic' },
      mockStrategyFunctions,
    );
    expect(anthropicResult.documents[0]).toMatchObject({ type: 'document' });
  });
});
