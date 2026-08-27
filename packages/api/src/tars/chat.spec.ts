import { rememberTarsChatContext, recallTarsChatContext, clearTarsChatContexts } from './chat';

const TTL_MS = 15 * 60_000;

beforeEach(() => {
  clearTarsChatContexts();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('tars chat context store', () => {
  it('recalls the model and brain recorded for a user', () => {
    rememberTarsChatContext('user-1', { model: 'gpt-5.4-mini', domainId: 100 });
    expect(recallTarsChatContext('user-1')).toEqual({ model: 'gpt-5.4-mini', domainId: '100' });
    expect(recallTarsChatContext('user-2')).toEqual({});
  });

  it('keeps users apart and replaces the entry on a new turn', () => {
    rememberTarsChatContext('user-1', { model: 'gpt-5.4-mini', domainId: 100 });
    rememberTarsChatContext('user-2', { model: 'claude-sonnet-4-6', domainId: 235 });
    rememberTarsChatContext('user-1', { model: 'gpt-5.5', domainId: 224 });

    expect(recallTarsChatContext('user-1')).toEqual({ model: 'gpt-5.5', domainId: '224' });
    expect(recallTarsChatContext('user-2')).toEqual({
      model: 'claude-sonnet-4-6',
      domainId: '235',
    });
  });

  it('records whichever half the turn actually names', () => {
    rememberTarsChatContext('user-1', { model: null, domainId: 100 });
    expect(recallTarsChatContext('user-1')).toEqual({ model: undefined, domainId: '100' });

    rememberTarsChatContext('user-2', { model: 'gpt-5.5', domainId: '' });
    expect(recallTarsChatContext('user-2')).toEqual({ model: 'gpt-5.5', domainId: undefined });
  });

  it('ignores a turn that names neither, and an unknown user', () => {
    rememberTarsChatContext('user-1', { model: '  ', domainId: null });
    rememberTarsChatContext('', { model: 'gpt-5.5', domainId: 100 });
    expect(recallTarsChatContext('user-1')).toEqual({});
  });

  it('trims the recorded values', () => {
    rememberTarsChatContext('user-1', { model: '  gpt-5.4-mini ', domainId: ' 100 ' });
    expect(recallTarsChatContext('user-1')).toEqual({ model: 'gpt-5.4-mini', domainId: '100' });
  });

  it('forgets an entry once it expires', () => {
    jest.useFakeTimers();
    rememberTarsChatContext('user-1', { model: 'gpt-5.4-mini', domainId: 100 });
    jest.advanceTimersByTime(TTL_MS - 1);
    expect(recallTarsChatContext('user-1').model).toBe('gpt-5.4-mini');
    jest.advanceTimersByTime(1);
    expect(recallTarsChatContext('user-1')).toEqual({});
  });

  it('stays bounded by evicting the least recently recorded user', () => {
    for (let i = 0; i < 1_100; i++) {
      rememberTarsChatContext(`user-${i}`, { model: `model-${i}`, domainId: 100 });
    }
    expect(recallTarsChatContext('user-0')).toEqual({});
    expect(recallTarsChatContext('user-1099').model).toBe('model-1099');
  });
});
