import { renderHook } from '@testing-library/react';
import { QueryKeys } from 'librechat-data-provider';
import useTarsMcpConnectRefresh from '../useTarsMcpConnectRefresh';

const mockInvalidate = jest.fn();
let mockStatus: Record<string, { connectionState: string }> | undefined;

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock('../useMCPConnectionStatus', () => ({
  useMCPConnectionStatus: () => ({ connectionStatus: mockStatus }),
}));

const renderRefresh = () => renderHook(() => useTarsMcpConnectRefresh(true));

describe('useTarsMcpConnectRefresh', () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
    mockStatus = { tars_demo: { connectionState: 'disconnected' } };
  });

  it('refreshes the chat tools when a sign-in connects a tars entry', () => {
    const { rerender } = renderRefresh();
    expect(mockInvalidate).not.toHaveBeenCalled();

    mockStatus = { tars_demo: { connectionState: 'connected' } };
    rerender();

    expect(mockInvalidate).toHaveBeenCalledWith([QueryKeys.tarsMcpChatTools]);
    expect(mockInvalidate).toHaveBeenCalledWith([QueryKeys.tarsMcpUserSettings]);
  });

  it('does not refresh again while the entry stays connected', () => {
    mockStatus = { tars_demo: { connectionState: 'connected' } };
    const { rerender } = renderRefresh();
    mockInvalidate.mockClear();

    mockStatus = { tars_demo: { connectionState: 'connected' } };
    rerender();

    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('refreshes after a reconnect, but not on the disconnect itself', () => {
    mockStatus = { tars_demo: { connectionState: 'connected' } };
    const { rerender } = renderRefresh();
    mockInvalidate.mockClear();

    mockStatus = { tars_demo: { connectionState: 'disconnected' } };
    rerender();
    expect(mockInvalidate).not.toHaveBeenCalled();

    mockStatus = { tars_demo: { connectionState: 'connected' } };
    rerender();
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
  });

  it('ignores servers that are not tars entries and a status still loading', () => {
    mockStatus = undefined;
    const { rerender } = renderRefresh();

    mockStatus = { workflow: { connectionState: 'connected' } };
    rerender();

    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
