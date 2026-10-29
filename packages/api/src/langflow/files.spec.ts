import { z } from 'zod';
import { TARS_WORKFLOW_FILES_ARGUMENT } from 'librechat-data-provider';
import { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TarsDataFileRef } from '~/tars/files/sign';
import type { TarsTurnFiles } from '~/tars/files/turn';
import { attachWorkflowFiles, selectWorkflowFiles, withWorkflowFiles } from './files';
import { verifyTarsFileSignature } from '~/tars/files/sign';

const turnFiles = (attachments: TarsTurnFiles['attachments']): TarsTurnFiles => ({
  dataFiles: [],
  textFiles: [],
  providerFiles: [],
  imageFiles: [],
  otherFiles: [],
  attachments,
  loadFileInput: async () => '',
  generatedFilesContext: null,
});

const SPECS = turnFiles([
  { id: 'doc-2s', filename: 'M14D5121632A(2S).pdf' },
  { id: 'audio-1', filename: 'memo.mp3' },
  { id: 'doc-2m', filename: 'M14D5121632A(2M).pdf' },
]);

type Received = { input_value?: string; [TARS_WORKFLOW_FILES_ARGUMENT]?: TarsDataFileRef[] };

function flowTool(serverName = 'workflow') {
  const received: Received[] = [];
  const tool = Object.assign(
    new DynamicStructuredTool({
      name: `compare_mcp_${serverName}`,
      description: 'A Langflow flow',
      schema: z.object({ input_value: z.string() }),
      func: async (input) => {
        received.push(input as Received);
        return 'done';
      },
    }),
    { mcp: true, mcpRawServerName: serverName },
  );
  return { tool, received };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'workflow-files-secret';
});

describe('selectWorkflowFiles', () => {
  it('keeps the attachments a flow reads, in turn order, up to the cap', () => {
    expect(selectWorkflowFiles(SPECS, 10).map((file) => file.id)).toEqual(['doc-2s', 'doc-2m']);
    expect(selectWorkflowFiles(SPECS, 1).map((file) => file.id)).toEqual(['doc-2s']);
    expect(selectWorkflowFiles(undefined, 10)).toEqual([]);
  });
});

describe('withWorkflowFiles', () => {
  const ref = { id: 'doc-2s', filename: 'a.pdf', path: '/api/tars/files/doc-2s?s=workflow' };

  it('replaces whatever the model put in the reserved argument', () => {
    const forged = { input_value: 'hi', [TARS_WORKFLOW_FILES_ARGUMENT]: [{ path: '/etc/passwd' }] };
    expect(withWorkflowFiles(forged, [ref])).toEqual({
      input_value: 'hi',
      [TARS_WORKFLOW_FILES_ARGUMENT]: [ref],
    });
    expect(withWorkflowFiles(forged, [])).toEqual({ input_value: 'hi' });
  });

  it('leaves non-object arguments alone', () => {
    expect(withWorkflowFiles('plain', [ref])).toBe('plain');
  });
});

describe('attachWorkflowFiles', () => {
  it("sends the turn's attachments as workflow-scoped references the model never produced", async () => {
    const { tool, received } = flowTool();
    attachWorkflowFiles([tool], { getTurnFiles: () => SPECS, userId: 'user-1' });

    await tool.invoke({ input_value: '列出兩份檔案的63BGA比對表' });

    const [args] = received;
    expect(args.input_value).toBe('列出兩份檔案的63BGA比對表');
    const refs = args[TARS_WORKFLOW_FILES_ARGUMENT] ?? [];
    expect(refs.map((ref) => ref.filename)).toEqual([
      'M14D5121632A(2S).pdf',
      'M14D5121632A(2M).pdf',
    ]);
    const url = new URL(refs[0].path, 'http://librechat.test');
    expect(
      verifyTarsFileSignature({
        scope: 'workflow',
        fileId: 'doc-2s',
        userId: url.searchParams.get('u') ?? '',
        expires: Number(url.searchParams.get('exp')),
        signature: url.searchParams.get('sig') ?? '',
      }),
    ).toBe(true);
  });

  it('reads the turn files when the flow is called, not when the tool loads', async () => {
    const { tool, received } = flowTool();
    const turn: { files?: TarsTurnFiles } = {};
    attachWorkflowFiles([tool], { getTurnFiles: () => turn.files, userId: 'user-1' });
    turn.files = SPECS;

    await tool.invoke({ input_value: 'go' });

    expect(received[0][TARS_WORKFLOW_FILES_ARGUMENT]).toHaveLength(2);
  });

  it('adds nothing without attachments, when disabled, or for other MCP servers', async () => {
    const empty = flowTool();
    const disabled = flowTool();
    const other = flowTool('tars_erp');
    attachWorkflowFiles([empty.tool], { getTurnFiles: () => turnFiles([]), userId: 'user-1' });
    attachWorkflowFiles([disabled.tool], {
      getTurnFiles: () => SPECS,
      userId: 'user-1',
      config: { enabled: false },
    });
    attachWorkflowFiles([other.tool], { getTurnFiles: () => SPECS, userId: 'user-1' });

    await Promise.all(
      [empty, disabled, other].map(({ tool }) => tool.invoke({ input_value: 'go' })),
    );

    for (const { received } of [empty, disabled, other]) {
      expect(received[0]).toEqual({ input_value: 'go' });
    }
  });
});
