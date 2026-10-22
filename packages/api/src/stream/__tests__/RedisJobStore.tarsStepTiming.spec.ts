import { RedisJobStore } from '../implementations/RedisJobStore';

const messageStep = (id: string, index: number) => ({
  event: 'on_run_step',
  data: {
    id,
    index,
    runId: 'response-1',
    type: 'message_creation',
    stepDetails: { type: 'message_creation', message_creation: { message_id: 'm-1' } },
  },
});

const closed = (id: string, index: number, created_at: number, closed_at: number) => ({
  event: 'on_run_step_closed',
  data: { id, index, type: 'message_creation', status: 'completed', created_at, closed_at },
});

/**
 * A resumed run rebuilds its content from the durable chunks, so the thinking /
 * answer timing the audit trace reads must come back from the same closures the
 * live run stamped them from (see `stampTarsStepTiming`).
 */
describe('RedisJobStore thinking and answer timing reconstruction', () => {
  it('restores each message step’s open and close times', async () => {
    const chunks = [
      messageStep('think-1', 0),
      {
        event: 'on_reasoning_delta',
        data: { id: 'think-1', delta: { content: [{ type: 'think', think: 'Let me check.' }] } },
      },
      closed('think-1', 0, 1_000, 4_000),
      messageStep('text-1', 1),
      {
        event: 'on_message_delta',
        data: { id: 'text-1', delta: { content: [{ type: 'text', text: 'Here it is.' }] } },
      },
      closed('text-1', 1, 4_000, 9_500),
    ];
    const store = Object.create(RedisJobStore.prototype) as RedisJobStore;
    const snapshot = jest.fn(async () => ({ chunks, durableEventCount: chunks.length }));
    Object.defineProperty(store, 'getChunkSnapshot', { value: snapshot });

    const result = await store.getContentParts('message-run', undefined, { durableOnly: true });

    expect(result?.content).toMatchObject([
      { type: 'think', think: 'Let me check.', tarsStepStartedAt: 1_000, tarsStepClosedAt: 4_000 },
      { type: 'text', text: 'Here it is.', tarsStepStartedAt: 4_000, tarsStepClosedAt: 9_500 },
    ]);
  });
});
