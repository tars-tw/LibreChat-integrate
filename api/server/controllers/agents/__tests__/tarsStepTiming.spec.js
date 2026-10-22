/**
 * TARS seam guard for `getDefaultHandlers`' step-closed handler: thinking and
 * answer parts must leave it with their measured times, which the audit trace
 * mirrored to pwc_tars reads (`stampTarsStepTiming`, packages/api/src/tars/trace.ts).
 *
 * Unlike callbacks.spec.js this keeps `@librechat/api` real, so the test fails
 * when a rebase drops the call from callbacks.js or the export from the package
 * — a dropped seam otherwise only shows up as inferred times in the timeline.
 * Only the services callbacks.js loads at require time are mocked, as there.
 */
const { ContentTypes } = require('librechat-data-provider');
const { GraphEvents } = require('@librechat/agents');

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
  preflightCodeOutputBatch: jest.fn(async () => []),
}));
jest.mock('~/server/services/Tools/credentials', () => ({ loadAuthValues: jest.fn() }));
jest.mock('~/server/services/Files/process', () => ({ saveBase64Image: jest.fn() }));

const { getDefaultHandlers } = require('../callbacks');

const closeStep = (handlers, id, created_at, closed_at, type = 'message_creation') =>
  handlers[GraphEvents.ON_RUN_STEP_CLOSED].handle(GraphEvents.ON_RUN_STEP_CLOSED, {
    id,
    index: 0,
    type,
    status: 'completed',
    created_at,
    closed_at,
  });

describe('TARS step timing seam in the step-closed handler', () => {
  const setup = (parts) => {
    const contentParts = parts;
    const stepMap = new Map(parts.map((_, index) => [`step-${index}`, { index }]));
    const handlers = getDefaultHandlers({
      res: { write: jest.fn() },
      aggregateContent: jest.fn(),
      contentParts,
      stepMap,
      toolEndCallback: jest.fn(),
      collectedUsage: [],
    });
    return { handlers, contentParts };
  };

  it('stamps thinking and answer parts with their measured step times', async () => {
    const { handlers, contentParts } = setup([
      { type: ContentTypes.THINK, think: 'Let me check.' },
      { type: ContentTypes.TEXT, text: 'Here it is.' },
    ]);

    await closeStep(handlers, 'step-0', 1_000, 4_000);
    await closeStep(handlers, 'step-1', 4_000, 9_500);

    expect(contentParts[0]).toMatchObject({ tarsStepStartedAt: 1_000, tarsStepClosedAt: 4_000 });
    expect(contentParts[1]).toMatchObject({ tarsStepStartedAt: 4_000, tarsStepClosedAt: 9_500 });
  });

  it('leaves tool calls to upstream’s own close stamp', async () => {
    const { handlers, contentParts } = setup([
      { type: ContentTypes.TOOL_CALL, tool_call: { id: 'call-1', name: 'query', args: '{}' } },
    ]);

    await closeStep(handlers, 'step-0', 1_000, 2_000, 'tool_calls');

    expect(contentParts[0]).not.toHaveProperty('tarsStepStartedAt');
    expect(contentParts[0].tool_call).toMatchObject({ runStepClosedAt: 2_000 });
  });
});

/** Same guard for the model-end handler: the trace's `message_stop` rows read it. */
describe('TARS finish reason seam in the model-end handler', () => {
  it('notes why the model call stopped beside the usage it collected', async () => {
    const { tarsFinishReasonOf } = jest.requireActual('@librechat/api');
    const collectedUsage = [];
    const handlers = getDefaultHandlers({
      res: { write: jest.fn() },
      aggregateContent: jest.fn(),
      contentParts: [],
      stepMap: new Map(),
      toolEndCallback: jest.fn(),
      collectedUsage,
    });

    await handlers[GraphEvents.CHAT_MODEL_END].handle(
      GraphEvents.CHAT_MODEL_END,
      {
        output: {
          usage_metadata: { input_tokens: 10, output_tokens: 4096, total_tokens: 4106 },
          response_metadata: { finish_reason: 'length' },
        },
      },
      { run_id: 'run-1', thread_id: 'convo-1', user_id: 'user-1' },
      { getAgentContext: () => ({}) },
    );

    expect(collectedUsage).toHaveLength(1);
    expect(tarsFinishReasonOf(collectedUsage[0])).toBe('length');
  });
});
