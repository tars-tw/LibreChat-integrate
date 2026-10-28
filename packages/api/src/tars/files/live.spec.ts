jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { z } from 'zod';
import { logger } from '@librechat/data-schemas';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Constants, Tools } from 'librechat-data-provider';
import { AIMessage, HumanMessage, ToolMessage } from '@librechat/agents/langchain/messages';
import {
  Run,
  Providers,
  GraphEvents,
  FakeChatModel,
  StandardGraph,
  buildSummaryCarrierText,
} from '@librechat/agents';
import type { EventHandler, ToolExecuteResult, ToolExecuteBatchRequest } from '@librechat/agents';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import type { TarsGeneratedLinkMessage } from './generated';
import { buildTarsGeneratedFilesContext, collectTarsGeneratedLinks } from './generated';
import { attachTarsGeneratedLinks, refreshTarsTurnGeneratedLinks } from './live';
import { createToolExecuteHandler } from '~/agents/handlers';
import { getThreadData } from '~/utils/message';

const FILE = '/api/tars/static/generate_output/kb';
const CHART = '/api/tars/static/quickchart/kb';
const TOOLS_NODE = { langgraph_node: 'tools=primary' };

const toolOutput = (artifact: Record<string, unknown>) => ({
  tool_call_id: 'c1',
  artifact: { [Tools.tars_trace]: artifact },
});

const stepOutput = (links: Array<{ type: string; url: string }>) =>
  toolOutput({ step: { tool: 'generate_file', ok: true, links } });

const createGraph = (additional_instructions = 'BASE') =>
  new StandardGraph({
    runId: 'tars-live-links',
    agents: [
      {
        agentId: 'primary',
        provider: Providers.OPENAI,
        instructions: 'You help.',
        additional_instructions,
      },
    ],
  });

const contextOf = (graph: StandardGraph) => {
  const context = graph.agentContexts.get('primary');
  if (!context) {
    throw new Error('agent context missing');
  }
  return context;
};

/**
 * Everything the next model call receives for `messages`, read off the real
 * `systemRunnable` every model call is piped through: the system prompt as
 * `@librechat/agents` builds it, plus the messages themselves.
 */
async function modelInput(
  graph: StandardGraph,
  messages: BaseMessage[] = [new HumanMessage('hi')],
): Promise<string> {
  const sent = (await contextOf(graph).systemRunnable?.invoke(messages)) ?? messages;
  return sent
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    )
    .join('\n');
}

describe('refreshTarsTurnGeneratedLinks', () => {
  beforeEach(() => jest.clearAllMocks());

  it("puts a just-generated file into the next model call's system prompt", async () => {
    const graph = createGraph();
    expect(await modelInput(graph)).not.toContain('report.xlsx');

    refreshTarsTurnGeneratedLinks(
      stepOutput([{ type: 'file', url: `${FILE}/report.xlsx?sig=a` }]),
      TOOLS_NODE,
      graph,
    );

    const text = await modelInput(graph);
    expect(text).toContain('# Generated this turn Runtime Context');
    expect(text).toContain(`- file: [report.xlsx](${FILE}/report.xlsx?sig=a)`);
    expect(text).toContain('BASE');
  });

  it('keeps one block for the turn, extended with every later link', () => {
    const graph = createGraph();
    refreshTarsTurnGeneratedLinks(
      stepOutput([{ type: 'file', url: `${FILE}/a.xlsx` }]),
      TOOLS_NODE,
      graph,
    );
    refreshTarsTurnGeneratedLinks(
      toolOutput({ trace: [], links: [{ type: 'chart', url: `${CHART}/b.png` }] }),
      TOOLS_NODE,
      graph,
    );

    const instructions = contextOf(graph).additionalInstructions ?? '';
    expect(instructions.match(/# Generated this turn/g)).toHaveLength(1);
    expect(instructions).toContain(`- file: [a.xlsx](${FILE}/a.xlsx)`);
    expect(instructions).toContain(`- chart: ![b.png](${CHART}/b.png)`);
    expect(instructions.startsWith('BASE\n')).toBe(true);
  });

  it('skips a link the turn-start list or this turn already names', () => {
    const listed = `${FILE}/old.xlsx`;
    const graph = createGraph(`# Generated files Runtime Context\n- file: [old.xlsx](${listed})`);
    const before = contextOf(graph).additionalInstructions;

    refreshTarsTurnGeneratedLinks(stepOutput([{ type: 'file', url: listed }]), TOOLS_NODE, graph);
    expect(contextOf(graph).additionalInstructions).toBe(before);

    const fresh = stepOutput([{ type: 'file', url: `${FILE}/new.xlsx` }]);
    refreshTarsTurnGeneratedLinks(fresh, TOOLS_NODE, graph);
    const once = contextOf(graph).additionalInstructions;
    refreshTarsTurnGeneratedLinks(fresh, TOOLS_NODE, graph);
    expect(contextOf(graph).additionalInstructions).toBe(once);
  });

  it('leaves the prompt alone for other tools and for TARS tools without links', () => {
    const graph = createGraph();
    const getAgentContext = jest.spyOn(graph, 'getAgentContext');

    refreshTarsTurnGeneratedLinks({ tool_call_id: 'c1', content: 'ok' }, TOOLS_NODE, graph);
    refreshTarsTurnGeneratedLinks(toolOutput({ trace: [] }), TOOLS_NODE, graph);
    refreshTarsTurnGeneratedLinks(stepOutput([{ type: 'file', url: ' ' }]), TOOLS_NODE, graph);

    expect(getAgentContext).not.toHaveBeenCalled();
    expect(contextOf(graph).additionalInstructions).toBe('BASE');
  });

  it('never throws, whatever the graph or metadata', () => {
    const output = stepOutput([{ type: 'file', url: `${FILE}/a.xlsx` }]);

    expect(() => refreshTarsTurnGeneratedLinks(output, undefined, createGraph())).not.toThrow();
    expect(() => refreshTarsTurnGeneratedLinks(output, TOOLS_NODE, undefined)).not.toThrow();
    expect(() =>
      refreshTarsTurnGeneratedLinks(output, { langgraph_node: 'tools=missing' }, createGraph()),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      '[tars-files] Could not list the generated links for this turn',
      expect.any(Error),
    );
  });

  it('does nothing when the agent context no longer has the fields it relies on', () => {
    const context = { additionalInstructions: 'BASE' };
    refreshTarsTurnGeneratedLinks(
      stepOutput([{ type: 'file', url: `${FILE}/a.xlsx` }]),
      TOOLS_NODE,
      { getAgentContext: () => context },
    );

    expect(context.additionalInstructions).toBe('BASE');
    expect(logger.warn).toHaveBeenCalledWith(
      '[tars-files] Agent context lacks the fields to list generated links',
    );
  });

  it('reads stored links that are not a list as none, without throwing', () => {
    const graph = createGraph();
    const malformed = toolOutput({ links: 5, step: { links: { url: `${FILE}/a.xlsx` } } });

    expect(() => refreshTarsTurnGeneratedLinks(malformed, TOOLS_NODE, graph)).not.toThrow();
    expect(contextOf(graph).additionalInstructions).toBe('BASE');
  });

  it('lists a link repeated within one output once', () => {
    const graph = createGraph();
    const repeated = { type: 'file', url: `${FILE}/a.xlsx` };
    refreshTarsTurnGeneratedLinks(
      toolOutput({ links: [repeated], step: { links: [repeated] } }),
      TOOLS_NODE,
      graph,
    );

    const instructions = contextOf(graph).additionalInstructions ?? '';
    expect(instructions.split(`${FILE}/a.xlsx`)).toHaveLength(2);
  });

  it('keeps every link of the turn, since the answer being written may need any of them', () => {
    const graph = createGraph();
    const links = Array.from({ length: 25 }, (_, i) => ({
      type: 'file',
      url: `${FILE}/${i}.xlsx`,
    }));
    refreshTarsTurnGeneratedLinks(stepOutput(links), TOOLS_NODE, graph);

    const instructions = contextOf(graph).additionalInstructions ?? '';
    expect(links.every((link) => instructions.includes(link.url))).toBe(true);
  });
});

describe('attachTarsGeneratedLinks', () => {
  const EXECUTE = GraphEvents.ON_TOOL_EXECUTE;

  /** A stand-in for `createToolExecuteHandler` that settles every batch with `results`. */
  const settlingWith = (results: ToolExecuteResult[]): EventHandler => ({
    handle: (_event, data) => (data as ToolExecuteBatchRequest).resolve(results),
  });

  const batch = (resolve: ToolExecuteBatchRequest['resolve']): ToolExecuteBatchRequest => ({
    toolCalls: [],
    metadata: TOOLS_NODE,
    resolve,
    reject: jest.fn(),
  });

  const result = (status: ToolExecuteResult['status'], url: string): ToolExecuteResult => ({
    toolCallId: 'c1',
    status,
    content: 'File created',
    artifact: stepOutput([{ type: 'file', url }]).artifact,
  });

  it('lists the links of successful results before the batch settles, results unchanged', async () => {
    const graph = createGraph();
    const settled = [result('success', `${FILE}/a.xlsx`)];
    let listedAtSettle = '';
    const resolve = jest.fn(() => {
      listedAtSettle = contextOf(graph).additionalInstructions ?? '';
    });
    const handlers: Record<string, EventHandler | undefined> = {
      [EXECUTE]: settlingWith(settled),
    };

    attachTarsGeneratedLinks(handlers);
    await handlers[EXECUTE]?.handle(EXECUTE, batch(resolve), {}, graph);

    expect(resolve).toHaveBeenCalledWith(settled);
    expect(listedAtSettle).toContain(`- file: [a.xlsx](${FILE}/a.xlsx)`);
  });

  it('skips results that did not succeed', async () => {
    const graph = createGraph();
    const resolve = jest.fn();
    const handlers: Record<string, EventHandler | undefined> = {
      [EXECUTE]: settlingWith([result('error', `${FILE}/a.xlsx`)]),
    };

    attachTarsGeneratedLinks(handlers);
    await handlers[EXECUTE]?.handle(EXECUTE, batch(resolve), {}, graph);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(contextOf(graph).additionalInstructions).toBe('BASE');
  });

  it('leaves a map without a tool-execute handler alone, and other data as it is', async () => {
    const empty: Record<string, EventHandler | undefined> = {};
    attachTarsGeneratedLinks(empty);
    expect(empty).toEqual({});

    const inner = { handle: jest.fn() };
    const handlers: Record<string, EventHandler | undefined> = { [EXECUTE]: inner };
    attachTarsGeneratedLinks(handlers);
    const data: Parameters<EventHandler['handle']>[1] = { output: 'ok' };
    await handlers[EXECUTE]?.handle(EXECUTE, data, TOOLS_NODE, undefined);

    expect(inner.handle).toHaveBeenCalledWith(EXECUTE, data, TOOLS_NODE, undefined);
  });
});

describe('generated links through a real run', () => {
  const NAME = 'tars_generate_file';
  const REPORT = `${FILE}/report.xlsx?sig=a`;
  const llmConfig = {
    provider: Providers.OPENAI,
    model: 'gpt-5.4-mini',
    apiKey: 'test-placeholder',
    streaming: true,
    streamUsage: false,
  };

  /**
   * One turn in which the model calls the tool and then answers, with the tool
   * run event-driven through the handler map `getDefaultHandlers`
   * (`api/server/controllers/agents/callbacks.js`) registers. Returns the
   * run's graph once the turn is done.
   */
  async function runTurn(): Promise<StandardGraph> {
    const tool = new DynamicStructuredTool({
      name: NAME,
      description: 'Generates a file',
      schema: z.object({ title: z.string() }),
      responseFormat: 'content_and_artifact',
      func: async () => ['File created', stepOutput([{ type: 'file', url: REPORT }]).artifact],
    });
    const customHandlers: Record<string, EventHandler | undefined> = {
      [GraphEvents.ON_TOOL_EXECUTE]: createToolExecuteHandler({
        loadTools: async () => ({ loadedTools: [tool] }),
      }),
    };
    attachTarsGeneratedLinks(customHandlers);
    const run = await Run.create({
      runId: 'tars-live-run',
      graphConfig: {
        type: 'standard',
        llmConfig,
        agents: [
          {
            agentId: 'primary',
            provider: Providers.OPENAI,
            endpoint: Providers.OPENAI,
            clientOptions: llmConfig,
            instructions: 'You help.',
            additional_instructions: 'BASE',
            tools: [],
            toolDefinitions: [
              {
                name: NAME,
                description: 'Generates a file',
                parameters: { type: 'object', properties: { title: { type: 'string' } } },
              },
            ],
          },
        ],
      },
      returnContent: true,
      customHandlers,
      tokenCounter: (text: unknown) => String(text ?? '').length,
      indexTokenCountMap: {},
    } as Parameters<typeof Run.create>[0]);
    if (!run.Graph) {
      throw new Error('The test run did not initialize its graph.');
    }
    run.Graph.overrideModel = new FakeChatModel({
      responses: ['Done.'],
      toolCalls: [{ name: NAME, args: { title: 'report' }, id: 'call_1', type: 'tool_call' }],
    });
    await run.processStream({ messages: [new HumanMessage('Make the report')] }, {
      configurable: { thread_id: 'tars-live-run', user_id: 'user-1' },
      version: 'v2',
    } as Parameters<typeof run.processStream>[1]);
    return run.Graph;
  }

  it('lists the file in the system prompt once the event-driven call settles', async () => {
    const text = await modelInput(await runTurn());

    expect(text).toContain('BASE');
    expect(text).toContain('# Generated this turn Runtime Context');
    expect(text).toContain(`- file: [report.xlsx](${REPORT})`);
  });
});

/**
 * Before / after: a summary that drops the generated file's link, as an LLM
 * summarizer may, applied through the real `@librechat/agents` summary APIs.
 * Without the TARS lists the link is gone; with them it survives.
 */
describe('a generated link through summarization', () => {
  const REPORT = `${FILE}/report_ab12cd.xlsx?sig=Zx9`;
  const SUMMARY_WITHOUT_LINK =
    '## Progress\n### Done\n- Queried the sales table and generated the requested Excel report.';

  describe('in the same turn', () => {
    /** The turn so far: the request, the tool call, and the result carrying the link. */
    const turnSoFar = (): BaseMessage[] => [
      new HumanMessage('Make me the sales report as Excel'),
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'tars_generate_file', args: { file_type: 'excel' } }],
      }),
      new ToolMessage({
        tool_call_id: 'call_1',
        content: `File created. Include this markdown link in your answer:\n\n[report](${REPORT})`,
      }),
    ];

    /** What the summarize node leaves: the summary carrier, then the turn's newest messages. */
    const afterSummary = (graph: StandardGraph): BaseMessage[] => {
      contextOf(graph).setSummary(SUMMARY_WITHOUT_LINK, 20);
      return [
        new HumanMessage(buildSummaryCarrierText(SUMMARY_WITHOUT_LINK)),
        new HumanMessage('Now add a chart of the same data.'),
      ];
    };

    it('reaches the model before the summary either way', async () => {
      expect(await modelInput(createGraph(), turnSoFar())).toContain(REPORT);
    });

    it('before: is lost once the summary replaces the tool result', async () => {
      const graph = createGraph();
      const input = await modelInput(graph, afterSummary(graph));
      expect(input).toContain(SUMMARY_WITHOUT_LINK);
      expect(input).not.toContain(REPORT);
    });

    it('after: survives the summary, listed when the call settled', async () => {
      const graph = createGraph();
      refreshTarsTurnGeneratedLinks(stepOutput([{ type: 'file', url: REPORT }]), TOOLS_NODE, graph);

      const input = await modelInput(graph, afterSummary(graph));
      expect(input).toContain(REPORT);
      expect(input).toContain('# Generated this turn Runtime Context');
      expect(input).toContain(SUMMARY_WITHOUT_LINK);
    });
  });

  describe('in a later turn', () => {
    const NO_PARENT = String(Constants.NO_PARENT);
    /** The stored thread: the turn that generated the report, its reply's `tars_trace` attachment. */
    const thread: TarsGeneratedLinkMessage[] = [
      { messageId: 'u1', parentMessageId: NO_PARENT },
      {
        messageId: 'a1',
        parentMessageId: 'u1',
        attachments: [
          {
            type: Tools.tars_trace,
            [Tools.tars_trace]: { step: { links: [{ type: 'file', url: REPORT }] } },
          },
        ],
      },
      { messageId: 'u2', parentMessageId: 'a1' },
      { messageId: 'a2', parentMessageId: 'u2' },
    ];

    /**
     * The summary checkpoint replaces everything before it: the model gets the
     * summary (as `initialSummary`, in the system prompt) and only the new request.
     */
    const laterTurn = (graph: StandardGraph): BaseMessage[] => {
      contextOf(graph).setInitialSummary(SUMMARY_WITHOUT_LINK, 20);
      return [new HumanMessage('Send me the link to that report again')];
    };

    it('before: is lost with the summarized messages', async () => {
      const graph = createGraph();
      const input = await modelInput(graph, laterTurn(graph));
      expect(input).toContain(SUMMARY_WITHOUT_LINK);
      expect(input).not.toContain(REPORT);
    });

    it('after: survives, listed from the stored attachments', async () => {
      const links = collectTarsGeneratedLinks(thread, getThreadData(thread, 'a2').messageIds);
      /** Joined the way `createRun` joins `dynamicToolContextMap` into the instructions. */
      const graph = createGraph([buildTarsGeneratedFilesContext(links), 'BASE'].join('\n'));

      const input = await modelInput(graph, laterTurn(graph));
      expect(input).toContain(`[report_ab12cd.xlsx](${REPORT})`);
      expect(input).toContain(SUMMARY_WITHOUT_LINK);
    });
  });
});
