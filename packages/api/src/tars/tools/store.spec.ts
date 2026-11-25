import { getTarsToolUsage, takeTarsToolUsage, recordTarsCallUsage } from './usage';
import { createTarsRequestStore } from './store';

describe('createTarsRequestStore', () => {
  const store = createTarsRequestStore<number[]>((previous, next) => [
    ...(previous ?? []),
    ...next,
  ]);

  it('merges repeated records of one call and keeps calls apart', () => {
    const owner = {};
    store.record(owner, 'call-1', [1]);
    store.record(owner, 'call-1', [2]);
    store.record(owner, 'call-2', [3]);
    expect([...store.get(owner)]).toEqual([
      ['call-1', [1, 2]],
      ['call-2', [3]],
    ]);
  });

  it('keeps each request to its own records', () => {
    const first = {};
    const second = {};
    store.record(first, 'call-1', [1]);
    expect(store.get(second).size).toBe(0);
  });

  it('records nothing for an owner that cannot key a WeakMap, or without a call id', () => {
    const store = createTarsRequestStore<number>((previous, next) => (previous ?? 0) + next);
    expect(() => store.record('request' as never, 'call-1', 1)).not.toThrow();
    const owner = {};
    store.record(owner, '', 1);
    expect(store.get(owner).size).toBe(0);
    expect(store.get('request' as never).size).toBe(0);
  });

  it('answers an empty map for a request without records or without an owner', () => {
    expect(store.get({}).size).toBe(0);
    expect(store.get(null).size).toBe(0);
    expect(store.get(undefined).size).toBe(0);
  });

  it('hands over what a request recorded once, then starts it afresh', () => {
    const owner = {};
    store.record(owner, 'call-1', [1]);
    expect([...store.take(owner)]).toEqual([['call-1', [1]]]);
    expect(store.take(owner).size).toBe(0);
    store.record(owner, 'call-2', [2]);
    expect([...store.get(owner)]).toEqual([['call-2', [2]]]);
    expect(store.take(null).size).toBe(0);
  });
});

describe('recordTarsCallUsage', () => {
  it('adds up one call’s usage and ignores calls without an owner, id or tokens', () => {
    const owner = {};
    const config = { toolCall: { id: 'call-1' } };
    recordTarsCallUsage(owner, config, { prompt: 100, completion: 20 });
    recordTarsCallUsage(owner, config, { prompt: 5 });
    recordTarsCallUsage(owner, config, { prompt: 0, completion: 0 });
    recordTarsCallUsage(owner, { toolCall: {} }, { prompt: 1 });
    recordTarsCallUsage(null, config, { prompt: 1 });
    expect([...getTarsToolUsage(owner)]).toEqual([
      ['call-1', { input_tokens: 105, output_tokens: 20 }],
    ]);
  });
});

describe('takeTarsToolUsage', () => {
  const config = (id: string) => ({ toolCall: { id } });

  it('hands the turn what its tools spent, and each later call to `late`', () => {
    const owner = {};
    const late = jest.fn();
    recordTarsCallUsage(owner, config('call-1'), { prompt: 30, completion: 4 });

    const taken = takeTarsToolUsage(owner, late);
    /** A background call, or a detached subagent's, settles after the turn was mirrored. */
    recordTarsCallUsage(owner, config('call-2'), { prompt: 7, completion: 1 });

    expect([...taken]).toEqual([['call-1', { input_tokens: 30, output_tokens: 4 }]]);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith({ input_tokens: 7, output_tokens: 1 });
    expect(getTarsToolUsage(owner).size).toBe(0);
  });

  it('counts nothing twice when the turn is taken again, and hands later calls to the new `late`', () => {
    const owner = {};
    const first = jest.fn();
    const second = jest.fn();
    recordTarsCallUsage(owner, config('call-1'), { prompt: 30 });
    takeTarsToolUsage(owner, first);

    expect(takeTarsToolUsage(owner, second).size).toBe(0);
    recordTarsCallUsage(owner, config('call-2'), { prompt: 5 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ input_tokens: 5, output_tokens: 0 });
  });

  it('never fails the tool call when `late` throws', () => {
    const owner = {};
    takeTarsToolUsage(owner, () => {
      throw new Error('boom');
    });

    expect(() => recordTarsCallUsage(owner, config('call-1'), { prompt: 5 })).not.toThrow();
  });

  it('keeps nothing for a request it cannot key', () => {
    expect(takeTarsToolUsage(null, jest.fn()).size).toBe(0);
  });
});
