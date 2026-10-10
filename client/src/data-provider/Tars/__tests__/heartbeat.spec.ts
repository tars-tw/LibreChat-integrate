import { renderHook } from '@testing-library/react';
import { Time, dataService } from 'librechat-data-provider';
import { useTarsHeartbeat } from '../heartbeat';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService, sendTarsHeartbeat: jest.fn() } };
});

const sendTarsHeartbeat = dataService.sendTarsHeartbeat as jest.Mock;

describe('useTarsHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendTarsHeartbeat.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays silent until the user is signed in', () => {
    renderHook(() => useTarsHeartbeat(false));
    jest.advanceTimersByTime(Time.TWO_MINUTES * 2);
    expect(sendTarsHeartbeat).not.toHaveBeenCalled();
  });

  it('beats at once and then every two minutes', () => {
    renderHook(() => useTarsHeartbeat(true));
    expect(sendTarsHeartbeat).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(Time.TWO_MINUTES * 2);
    expect(sendTarsHeartbeat).toHaveBeenCalledTimes(3);
  });

  it('keeps beating after a failed beat', async () => {
    sendTarsHeartbeat.mockRejectedValueOnce(new Error('pwc_tars down'));
    renderHook(() => useTarsHeartbeat(true));
    await Promise.resolve();

    jest.advanceTimersByTime(Time.TWO_MINUTES);
    expect(sendTarsHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('stops beating on sign-out', () => {
    const { rerender } = renderHook(({ auth }) => useTarsHeartbeat(auth), {
      initialProps: { auth: true },
    });
    rerender({ auth: false });

    jest.advanceTimersByTime(Time.TWO_MINUTES * 2);
    expect(sendTarsHeartbeat).toHaveBeenCalledTimes(1);
  });
});
