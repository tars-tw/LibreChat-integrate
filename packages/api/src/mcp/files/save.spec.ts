import { FileContext } from 'librechat-data-provider';
import type { MCPFileArtifact } from '../types';
import type { MCPToolFileRecord } from './save';
import { saveMCPToolFiles } from './save';

const file = (filename: string, text?: string): MCPFileArtifact => ({
  filename,
  mimeType: 'application/pdf',
  data: Buffer.from(`%PDF ${filename}`).toString('base64'),
  bytes: 5 + filename.length,
  ...(text ? { text } : {}),
});

const target = { messageId: 'msg-1', conversationId: 'convo-1', toolCallId: 'call-1' };

describe('saveMCPToolFiles', () => {
  it('stores each file under a fresh id and attaches it to the reply', async () => {
    const persist = jest.fn(async (buffer: Buffer, record: MCPToolFileRecord) => ({
      ...record,
      filepath: `/uploads/${record.file_id}`,
      written: buffer.toString(),
    }));

    const saved = await Promise.all(
      saveMCPToolFiles([file('a.pdf', 'page one'), file('../b.pdf')], persist, target),
    );

    expect(persist).toHaveBeenCalledTimes(2);
    const [first, second] = saved;
    expect(first).toMatchObject({
      ...target,
      filename: 'a.pdf',
      type: 'application/pdf',
      context: FileContext.mcp_tool,
      text: 'page one',
      written: '%PDF a.pdf',
    });
    expect(second?.filename).toBe('b.pdf');
    expect(second).not.toHaveProperty('text');
    expect(first?.file_id).not.toBe(second?.file_id);
  });

  it('resolves a failed save to null without holding up the others', async () => {
    const persist = jest
      .fn<Promise<MCPToolFileRecord>, [Buffer, MCPToolFileRecord]>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(async (_buffer, record) => record);

    const saved = await Promise.all(
      saveMCPToolFiles([file('a.pdf'), file('b.pdf')], persist, target),
    );

    expect(saved[0]).toBeNull();
    expect(saved[1]?.filename).toBe('b.pdf');
  });

  it('never saves a text candidate the wrapper did not accept', async () => {
    const persist = jest.fn(async (_buffer: Buffer, record: MCPToolFileRecord) => record);

    const saved = await Promise.all(
      saveMCPToolFiles([{ ...file('notes.md'), candidate: true }, file('a.pdf')], persist, target),
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved.map((entry) => entry?.filename)).toEqual(['a.pdf']);
  });

  it('has nothing to save without files', () => {
    expect(saveMCPToolFiles(undefined, jest.fn(), target)).toEqual([]);
  });
});
