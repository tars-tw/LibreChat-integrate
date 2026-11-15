const { FileContext } = require('librechat-data-provider');

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  writeAttachmentEvent: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('~/server/services/Files/Citations', () => ({ processFileCitations: jest.fn() }));
jest.mock('~/server/services/Files/Code/process', () => ({
  processCodeOutput: jest.fn(),
  runPreviewFinalize: jest.fn(),
}));
jest.mock('~/server/services/Files/Code/preflight', () => ({
  preflightCodeOutputBatch: jest.fn(),
}));
jest.mock('~/server/services/Tools/credentials', () => ({ loadAuthValues: jest.fn() }));
jest.mock('~/server/services/Files/process', () => ({
  saveBase64Image: jest.fn(async () => ({ file_id: 'img-1', filepath: '/images/img-1.png' })),
  saveToolFileBuffer: jest.fn(async ({ record }) => ({
    ...record,
    filepath: `/uploads/${record.file_id}-${record.filename}`,
  })),
}));

const { saveBase64Image, saveToolFileBuffer } = require('~/server/services/Files/process');
const { writeAttachmentEvent } = require('@librechat/api');
const { createToolEndCallback, createResponsesToolEndCallback } = require('../callbacks');

/** TARS: guards the `mcp_files` branches of both tool-end callbacks across upstream rebases. */
describe('createToolEndCallback — files an MCP tool returned', () => {
  const pdf = Buffer.from('%PDF-1.4 report');
  const req = { user: { id: 'user-1' }, config: {} };
  const metadata = { run_id: 'msg-1', thread_id: 'convo-1', provider: 'openAI' };

  beforeEach(() => jest.clearAllMocks());

  it('saves each file as an attachment of the reply, alongside the image artifacts', async () => {
    const artifactPromises = [];
    const res = { headersSent: false };
    const callback = createToolEndCallback({ req, res, artifactPromises });

    await callback(
      {
        output: {
          name: 'export_mcp_reports',
          tool_call_id: 'call-1',
          artifact: {
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }],
            mcp_files: [
              {
                filename: 'report.pdf',
                mimeType: 'application/pdf',
                data: pdf.toString('base64'),
                bytes: pdf.byteLength,
                text: 'report text',
              },
            ],
          },
        },
      },
      metadata,
    );
    const attachments = await Promise.all(artifactPromises);

    expect(saveToolFileBuffer).toHaveBeenCalledTimes(1);
    const [{ buffer, record }] = saveToolFileBuffer.mock.calls[0];
    expect(buffer.equals(pdf)).toBe(true);
    expect(record).toMatchObject({
      filename: 'report.pdf',
      type: 'application/pdf',
      context: FileContext.mcp_tool,
      text: 'report text',
    });
    expect(attachments).toContainEqual(
      expect.objectContaining({
        filename: 'report.pdf',
        messageId: 'msg-1',
        conversationId: 'convo-1',
        toolCallId: 'call-1',
      }),
    );
    expect(saveBase64Image).toHaveBeenCalledTimes(1);
  });
});

describe('createResponsesToolEndCallback — files an MCP tool returned', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves the file and emits it as a Responses attachment', async () => {
    const csv = Buffer.from('item,qty\nPLUM-2918,42\n');
    const artifactPromises = [];
    const res = { headersSent: true, writableEnded: false };
    const tracker = { nextSequence: jest.fn(() => 7) };
    const callback = createResponsesToolEndCallback({
      req: { user: { id: 'user-1' }, config: {} },
      res,
      tracker,
      artifactPromises,
    });

    await callback(
      {
        output: {
          name: 'export_mcp_inventory',
          tool_call_id: 'call-9',
          artifact: {
            mcp_files: [
              {
                filename: 'inventory.csv',
                mimeType: 'text/csv',
                data: csv.toString('base64'),
                bytes: csv.byteLength,
                text: csv.toString(),
              },
            ],
          },
        },
      },
      { run_id: 'msg-9', thread_id: 'convo-9' },
    );
    const [saved] = await Promise.all(artifactPromises);

    expect(saveToolFileBuffer).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ filename: 'inventory.csv', toolCallId: 'call-9' });
    expect(writeAttachmentEvent).toHaveBeenCalledWith(
      res,
      7,
      expect.objectContaining({
        filename: 'inventory.csv',
        type: 'text/csv',
        tool_call_id: 'call-9',
      }),
      { messageId: 'msg-9', conversationId: 'convo-9' },
    );
  });
});
