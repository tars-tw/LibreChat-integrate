import http from 'http';
import type { AddressInfo } from 'net';
import { transcribeWithGemini } from './transcribe';

interface Captured {
  path?: string;
  key?: string;
  body?: {
    contents: Array<{
      parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
    }>;
    generationConfig: { temperature: number };
  };
}

describe('transcribeWithGemini', () => {
  let server: http.Server;
  let reply: unknown;
  let status = 200;
  const captured: Captured = {};
  let base: string;
  let allowed: string[];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        captured.path = req.url;
        captured.key = req.headers['x-goog-api-key'] as string;
        captured.body = JSON.parse(raw);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/v1beta`;
    allowed = [`127.0.0.1:${port}`];
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    status = 200;
  });

  const run = (mimeType = 'audio/mpeg') =>
    transcribeWithGemini({
      config: { url: base, apiKey: 'gemini-key', model: 'gemini-3.6-flash' },
      audio: Buffer.from('audio-bytes'),
      mimeType,
      allowedAddresses: allowed,
    });

  it('sends the audio inline with the transcription prompt and returns the text', async () => {
    reply = {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'thinking…', thought: true }, { text: ' 北區業績 ' }] },
        },
      ],
    };

    await expect(run()).resolves.toBe('北區業績');
    expect(captured.path).toBe('/v1beta/models/gemini-3.6-flash:generateContent');
    expect(captured.key).toBe('gemini-key');
    const [prompt, audio] = captured.body?.contents[0].parts ?? [];
    expect(prompt.text).toContain('verbatim');
    expect(audio.inline_data).toEqual({
      mime_type: 'audio/mp3',
      data: Buffer.from('audio-bytes').toString('base64'),
    });
    expect(captured.body?.generationConfig.temperature).toBe(0);
  });

  it('refuses a transcript cut at the output limit', async () => {
    reply = {
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }],
    };
    await expect(run()).rejects.toThrow('output limit');
  });

  it('reports a blocked or empty reply instead of an empty transcript', async () => {
    reply = { promptFeedback: { blockReason: 'SAFETY' } };
    await expect(run()).rejects.toThrow('SAFETY');
    reply = { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] };
    await expect(run()).rejects.toThrow('empty transcript');
  });

  it('surfaces an API error', async () => {
    status = 400;
    reply = { error: { message: 'Unsupported MIME type' } };
    await expect(run('audio/webm')).rejects.toThrow('400');
  });
});
