import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useDeleteTarsUserMutation,
  useUpdateTarsUserMutation,
  useSyncTarsMcpServerMutation,
  useDeleteTarsMcpToolMutation,
  useUpdateTarsMcpUserServerMutation,
  useBulkDeleteTarsUsersMutation,
  useDeleteTarsMcpServerMutation,
  useUpdateTarsMcpServerMutation,
  useDeleteTarsUserGroupMutation,
  useUpdateTarsUserGroupMutation,
  useSaveTarsMcpPermissionsMutation,
  useDeleteTarsMcpPermissionsMutation,
  useBatchDeleteTarsMcpServersMutation,
  useSaveTarsMcpServerPermissionsMutation,
} from '../mutations';
import { useTarsMcpServerPermissionsQuery } from '../queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  const resolved = () => jest.fn().mockResolvedValue({});
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getTarsMcpServerPermissions: jest.fn(),
      saveTarsMcpServerPermissions: resolved(),
      saveTarsMcpPermissions: resolved(),
      deleteTarsMcpPermissions: resolved(),
      deleteTarsMcpServer: resolved(),
      updateTarsMcpServer: resolved(),
      batchDeleteTarsMcpServers: resolved(),
      syncTarsMcpServer: resolved(),
      deleteTarsMcpTool: resolved(),
      deleteTarsUser: resolved(),
      updateTarsUser: resolved(),
      bulkDeleteTarsUsers: resolved(),
      deleteTarsUserGroup: resolved(),
      updateTarsUserGroup: resolved(),
      updateTarsMcpUserServer: resolved(),
    },
  };
});

/** Every view of `sys_mcp_permission` the permissions tab reads. */
const GRANT_KEYS = [
  QueryKeys.tarsMcpPermissionPrincipals,
  QueryKeys.tarsMcpPermissions,
  QueryKeys.tarsMcpServerPermissions,
];

const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, wrapper };
};

/** Keys invalidated with `refetchType: 'all'` — the only kind a closed tab picks up again. */
const refetchedEverywhere = (invalidate: jest.SpyInstance) =>
  invalidate.mock.calls
    .filter(([, filters]) => (filters as { refetchType?: string })?.refetchType === 'all')
    .map(([key]) => (key as string[])[0]);

/** Any of the hooks under test: only `mutateAsync` is used, whatever its variables. */
type AnyMutation = () => { mutateAsync: (variables: never) => Promise<unknown> };

const run = async (useMutation: AnyMutation, variables: unknown) => {
  const { invalidate, wrapper } = setup();
  const { result } = renderHook(() => useMutation(), { wrapper });
  await result.current.mutateAsync(variables as never);
  return invalidate;
};

describe('MCP grant cache sync', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each<[string, AnyMutation, unknown]>([
    [
      'saving from the server side',
      useSaveTarsMcpServerPermissionsMutation,
      { mcp_server_id: 's1', principals: [] },
    ],
    [
      'saving from the principal side',
      useSaveTarsMcpPermissionsMutation,
      { user_ids: ['u1'], user_group_ids: [], servers: [] },
    ],
    ['removing a principal', useDeleteTarsMcpPermissionsMutation, { type: 'user', id: 'u1' }],
    ['deleting a server', useDeleteTarsMcpServerMutation, 's1'],
    ['deleting servers in bulk', useBatchDeleteTarsMcpServersMutation, ['s1']],
    ['syncing a server (may delete tools)', useSyncTarsMcpServerMutation, 's1'],
    ['deleting a tool', useDeleteTarsMcpToolMutation, 't1'],
    ['deleting a user', useDeleteTarsUserMutation, 'u1'],
    ['deleting users in bulk', useBulkDeleteTarsUsersMutation, ['u1']],
    ['editing a user (name / status)', useUpdateTarsUserMutation, { id: 'u1', data: {} }],
    ['deleting a group', useDeleteTarsUserGroupMutation, 'g1'],
    ['editing a group (name / status)', useUpdateTarsUserGroupMutation, { id: 'g1', data: {} }],
  ])('refreshes every grant view after %s', async (_label, useMutation, variables) => {
    const invalidate = await run(useMutation, variables);

    expect(refetchedEverywhere(invalidate)).toEqual(expect.arrayContaining(GRANT_KEYS));
  });

  it('also refreshes the chat-side tools after a grant save', async () => {
    const invalidate = await run(useSaveTarsMcpServerPermissionsMutation, {
      mcp_server_id: 's1',
      principals: [],
    });

    expect(invalidate).toHaveBeenCalledWith([QueryKeys.tarsMcpChatTools]);
    expect(dataService.saveTarsMcpServerPermissions).toHaveBeenCalledWith({
      mcp_server_id: 's1',
      principals: [],
    });
  });

  it('refreshes the native MCP listings after a user opts a server in', async () => {
    const invalidate = await run(useUpdateTarsMcpUserServerMutation, {
      id: 's1',
      data: { is_enabled: true },
    });

    for (const key of [QueryKeys.mcpServers, QueryKeys.mcpTools, QueryKeys.mcpConnectionStatus]) {
      expect(invalidate).toHaveBeenCalledWith([key]);
    }
  });

  it('leaves the grant views alone when a server is only edited', async () => {
    const invalidate = await run(useUpdateTarsMcpServerMutation, {
      id: 's1',
      data: { name: 'renamed' },
    });

    expect(refetchedEverywhere(invalidate)).toEqual([]);
  });
});

describe('useTarsMcpServerPermissionsQuery', () => {
  it('sends nothing until a server is picked', () => {
    const { wrapper } = setup();
    renderHook(() => useTarsMcpServerPermissionsQuery(null), { wrapper });

    expect(dataService.getTarsMcpServerPermissions).not.toHaveBeenCalled();
  });
});
