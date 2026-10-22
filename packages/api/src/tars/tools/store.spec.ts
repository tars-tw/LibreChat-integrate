import { recordTarsCallUsage, getTarsToolUsage } from './usage';
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
