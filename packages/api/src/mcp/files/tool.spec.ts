import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { MCPFileToolCandidate } from './tool';
import type { MCPFileArtifact } from '../types';
import { attachMCPFileOutputs, processMCPFileOutput, readMCPFileText } from './tool';
import { formatToolContent } from '../parsers';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sampleDocx = readFileSync(path.join(__dirname, '../../files/documents/sample.docx'));

const docxFile = (overrides: Partial<MCPFileArtifact> = {}): MCPFileArtifact => ({
  filename: 'sample.docx',
  mimeType: DOCX,
  data: sampleDocx.toString('base64'),
  bytes: sampleDocx.byteLength,
  ...overrides,
});

const zipFile: MCPFileArtifact = {
  filename: 'bundle.zip',
  mimeType: 'application/zip',
  data: Buffer.from('PK\u0003\u0004\u0000').toString('base64'),
  bytes: 5,
};

describe('readMCPFileText', () => {
  it('reads a document through the upload parsers', async () => {
    const text = await readMCPFileText(docxFile());

    expect(text?.trim().length).toBeGreaterThan(0);
  });

  it('has no reader for a non-document type', async () => {
    await expect(readMCPFileText(zipFile)).resolves.toBeUndefined();
  });
});

describe('processMCPFileOutput', () => {
  it('adds a document’s text to the tool result and keeps it on the saved file', async () => {
    const expected = (await readMCPFileText(docxFile())) ?? '';

    const [content, artifact] = (await processMCPFileOutput([
      'Resource File: sample.docx',
      { mcp_files: [docxFile()] },
    ])) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(content).toContain('Resource File: sample.docx');
    expect(content).toContain('File "sample.docx" was saved and attached to your reply');
    expect(content).toContain(expected.trim().slice(0, 40));
    expect(artifact.mcp_files[0].text).toBe(expected);
  });

  it('truncates the text the model reads but stores all of it', async () => {
    const readText = jest.fn(async () => 'x'.repeat(50));

    const [content, artifact] = (await processMCPFileOutput(['', { mcp_files: [docxFile()] }], {
      config: { maxTextChars: 10 },
      readText,
    })) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(content).toContain(`${'x'.repeat(10)}\n[... truncated; 40 more characters`);
    expect(artifact.mcp_files[0].text).toHaveLength(50);
  });

  it('drops a file over the size limit and says so', async () => {
    const [content, artifact] = (await processMCPFileOutput(
      ['done', { mcp_files: [docxFile(), zipFile] }],
      { config: { maxBytes: 10 } },
    )) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(artifact.mcp_files.map((file) => file.filename)).toEqual(['bundle.zip']);
    expect(content).toContain('"sample.docx"');
    expect(content).toContain('exceeds the 10-byte limit');
  });

  it('drops a file over 10MB by default, matching what the MCP transport can carry', async () => {
    const limit = 10 * 1024 * 1024;
    const readText = jest.fn(async () => undefined);

    const [content, artifact] = (await processMCPFileOutput(
      [
        '',
        {
          mcp_files: [
            { ...zipFile, bytes: limit },
            { ...zipFile, filename: 'big.zip', bytes: limit + 1 },
          ],
        },
      ],
      { readText },
    )) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(artifact.mcp_files.map((file) => file.filename)).toEqual(['bundle.zip']);
    expect(content).toContain(
      `File "big.zip" (${limit + 1} bytes) exceeds the ${limit}-byte limit`,
    );
  });

  it('saves a file it cannot read without failing the call', async () => {
    const readText = jest.fn(async () => {
      throw new Error('corrupt');
    });

    const [content, artifact] = (await processMCPFileOutput(['', { mcp_files: [docxFile()] }], {
      readText,
    })) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(artifact.mcp_files[0].text).toBeUndefined();
    expect(content).toBe(
      'File "sample.docx" was saved and attached to your reply; the user can open or download it there.',
    );
  });

  it('keeps the other artifacts and drops the files when disabled', async () => {
    const images = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }];

    const output = await processMCPFileOutput(['text', { content: images, mcp_files: [zipFile] }], {
      config: { enabled: false },
    });

    expect(output).toEqual(['text', { content: images }]);
  });

  it('leaves results without files untouched', async () => {
    const output: [string, undefined] = ['plain', undefined];

    await expect(processMCPFileOutput(output)).resolves.toBe(output);
  });
});

describe('text files (tars.mcpFiles.textTypes)', () => {
  const CSV = 'item,qty\nPLUM-2918,42\n';
  const textResult = (mimeType: string, meta?: Record<string, unknown>) =>
    formatToolContent(
      {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///inventory.csv',
              mimeType,
              text: CSV,
              ...(meta ? { _meta: meta } : {}),
            },
          },
        ],
      },
      'openai',
    );

  it('saves a CSV and leaves its text inline without reading it again', async () => {
    const readText = jest.fn(async () => 'never');

    const [content, artifact] = (await processMCPFileOutput(textResult('text/csv; charset=utf-8'), {
      readText,
    })) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(readText).not.toHaveBeenCalled();
    expect(content).toContain(`Resource Text: ${CSV}`);
    expect(content).toContain('File "inventory.csv" was saved and attached to your reply');
    expect(artifact.mcp_files).toEqual([
      {
        filename: 'inventory.csv',
        mimeType: 'text/csv',
        data: Buffer.from(CSV).toString('base64'),
        bytes: Buffer.byteLength(CSV),
        text: CSV,
      },
    ]);
  });

  it('keeps plain text, Markdown and code as text only', async () => {
    for (const mimeType of ['text/plain', 'text/markdown', 'text/x-python']) {
      const [content, artifact] = (await processMCPFileOutput(textResult(mimeType))) as [
        string,
        unknown,
      ];
      expect(artifact).toBeUndefined();
      expect(content).not.toContain('was saved');
    }
  });

  it('follows the configured types', async () => {
    const [, artifact] = (await processMCPFileOutput(textResult('text/markdown'), {
      config: { textTypes: ['Text/Markdown'] },
    })) as [string, { mcp_files: MCPFileArtifact[] }];
    const [, csvArtifact] = (await processMCPFileOutput(textResult('text/csv'), {
      config: { textTypes: [] },
    })) as [string, unknown];

    expect(artifact.mcp_files[0].mimeType).toBe('text/markdown');
    expect(csvArtifact).toBeUndefined();
  });

  it('saves any text the server marked as an attachment', async () => {
    const [, artifact] = (await processMCPFileOutput(
      textResult('application/json', { 'tars/attachment': true }),
      { config: { textTypes: [] } },
    )) as [string, { mcp_files: MCPFileArtifact[] }];

    expect(artifact.mcp_files[0]).toMatchObject({
      mimeType: 'application/json',
      attachment: true,
    });
    expect(artifact.mcp_files[0]).not.toHaveProperty('candidate');
  });

  it('holds a text file to the size limit', async () => {
    const [content, artifact] = (await processMCPFileOutput(textResult('text/csv'), {
      config: { maxBytes: 5 },
    })) as [string, unknown];

    expect(artifact).toBeUndefined();
    expect(content).toContain('exceeds the 5-byte limit');
  });
});

describe('attachMCPFileOutputs', () => {
  it('post-processes MCP tools only, end to end from a parsed tool result', async () => {
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]).toString('base64');
    const mcpResult = formatToolContent(
      {
        content: [
          { type: 'text', text: 'exported' },
          {
            type: 'resource',
            resource: { uri: 'file:///bundle.zip', mimeType: 'application/zip', blob: binary },
          },
        ],
      },
      'openai',
    );
    const nativeOutput = ['native', { mcp_files: [zipFile] }];
    const mcpTool: MCPFileToolCandidate = {
      name: 'export_mcp_files',
      mcp: true,
      func: async () => mcpResult,
    };
    const nativeTool: MCPFileToolCandidate = { name: 'web_search', func: async () => nativeOutput };

    attachMCPFileOutputs([mcpTool, nativeTool]);

    const [content, artifact] = (await mcpTool.func?.({}, undefined, undefined)) as [
      string,
      { mcp_files: MCPFileArtifact[] },
    ];
    expect(content).toContain('exported');
    expect(content).toContain('File "bundle.zip" was saved and attached to your reply');
    expect(artifact.mcp_files[0]).toMatchObject({ filename: 'bundle.zip', bytes: 5 });
    await expect(nativeTool.func?.({}, undefined, undefined)).resolves.toBe(nativeOutput);
  });
});
