jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  PrincipalType,
  ResourceType,
  TARS_MCP_SHARE_BLOCKED,
  TARS_MCP_PUBLIC_SHARE_BLOCKED,
  TARS_MCP_SHARE_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import type { Request, NextFunction, Response as ExpressResponse } from 'express';
import type { TarsAvailableToolRow } from './client';
import type { TarsAgentShareDeps } from './share';
import { clearTarsMcpEntryNames } from './names';
import { createTarsAgentShare } from './share';

const BASE_URL = 'http://tars.test';
const LIST_REPOS = 'list_repos_mcp_tars_github';
const GET_FILE = 'get_file_mcp_tars_github';
const GITHUB_TOKEN = 'sys__server__sys_mcp_tars_github';
const MAPS_ALL = 'sys__all__sys_mcp_tars_maps';

const toolRow = (overrides: Partial<TarsAvailableToolRow>): TarsAvailableToolRow => ({
  server_id: 's-github',
  server_name: 'Github-repo',
  server_code: 'github',
  server_type: 'external',
  tool_id: 't-list',
  tool_name: 'list_repos',
  ...overrides,
});

const ROWS = [
  toolRow({}),
  toolRow({ tool_id: 't-file', tool_name: 'get_file' }),
  toolRow({
    server_id: 's-maps',
    server_name: 'Google Maps',
    server_code: 'maps',
    tool_id: 't-place',
    tool_name: 'search_places',
  }),
  toolRow({ server_id: 's-web', server_code: 'web', server_type: 'builtin', tool_id: 't-web' }),
];

const GAP = { mcp_server_id: 's-github', server_name: 'Github-repo', no_access: true };

const jsonResponse = (data: unknown): Response =>
  ({ status: 200, ok: true, json: async () => ({ success: true, data }) }) as unknown as Response;

/** Serves pwc_tars and records every `share-check` body. */
const mockTars = (missing: unknown[] = []) => {
  const checks: Array<{ principals: unknown[]; servers: unknown[] }> = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/mcp/available-tools') {
      return jsonResponse(ROWS);
    }
    if (url.pathname === '/api/mcp/share-check') {
      checks.push(JSON.parse(String(init?.body)));
      return jsonResponse({ missing });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return checks;
};

const createDeps = (overrides: Partial<TarsAgentShareDeps> = {}): TarsAgentShareDeps => ({
  getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: [LIST_REPOS] }),
  findEntriesByResource: jest.fn().mockResolvedValue([]),
  findUsersByIds: jest.fn().mockResolvedValue([]),
  findGroupsByIds: jest.fn().mockResolvedValue([]),
  ...overrides,
});

const AMY = { type: PrincipalType.USER, idOnTheSource: 'amy', name: 'Amy' };
const GROUP = { type: PrincipalType.GROUP, idOnTheSource: 'g1', name: 'UAT' };

const runGuard = async (
  deps: TarsAgentShareDeps,
  body: unknown,
  resourceType: string = ResourceType.AGENT,
) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn() as NextFunction;
  const req = { params: { resourceType, resourceId: 'a1' }, body } as unknown as Request;
  await createTarsAgentShare(deps).guard(req, res as unknown as ExpressResponse, next);
  return { res, next };
};

describe('createTarsAgentShare', () => {
  const savedUrl = process.env.TARS_AUTH_URL;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    clearTarsMcpEntryNames();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedUrl === undefined) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = savedUrl;
    }
  });

  describe('guard', () => {
    it('passes what the agent binds to pwc_tars, by tool id and whole server', async () => {
      const checks = mockTars();
      const deps = createDeps({
        getAgent: jest.fn().mockResolvedValue({
          _id: 'a1',
          tools: [GITHUB_TOKEN, LIST_REPOS, GET_FILE, MAPS_ALL, 'web_search'],
        }),
      });

      const { next } = await runGuard(deps, { updated: [AMY, GROUP] });

      expect(next).toHaveBeenCalledTimes(1);
      expect(checks).toEqual([
        {
          principals: [
            { principal_type: 'user', principal_id: 'amy' },
            { principal_type: 'group', principal_id: 'g1' },
          ],
          servers: [
            { mcp_server_id: 's-github', mcp_tool_ids: ['t-list', 't-file'] },
            { mcp_server_id: 's-maps', mcp_tool_ids: [] },
          ],
        },
      ]);
    });

    it('refuses with who lacks what, and writes nothing', async () => {
      mockTars([
        {
          principal_type: 'user',
          principal_id: 'amy',
          servers: [{ ...GAP, tool_names: ['list_repos'] }],
        },
      ]);

      const { res, next } = await runGuard(createDeps(), { updated: [AMY, GROUP] });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: TARS_MCP_SHARE_BLOCKED,
          blocked: [
            {
              principal_type: 'user',
              idOnTheSource: 'amy',
              name: 'Amy',
              servers: [{ ...GAP, tool_names: ['list_repos'] }],
            },
          ],
        }),
      );
    });

    it('checks the remote-agent share dialog as well', async () => {
      const checks = mockTars();

      await runGuard(createDeps(), { updated: [AMY] }, ResourceType.REMOTE_AGENT);

      expect(checks).toHaveLength(1);
    });

    it.each([
      ['everyone', { public: true }],
      ['a role', { updated: [{ type: PrincipalType.ROLE, id: 'USER' }] }],
    ])(
      'refuses sharing with %s, which cannot be checked person by person',
      async (_label, body) => {
        const checks = mockTars();

        const { res, next } = await runGuard(createDeps(), body);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: TARS_MCP_PUBLIC_SHARE_BLOCKED }),
        );
        expect(checks).toEqual([]);
      },
    );

    it('stays closed when pwc_tars cannot answer', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

      const { res, next } = await runGuard(createDeps(), { updated: [AMY] });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: TARS_MCP_SHARE_CHECK_UNAVAILABLE }),
      );
    });

    it.each<[string, Partial<TarsAgentShareDeps>, unknown]>([
      [
        'an agent with no gateway tools',
        { getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: ['web_search'] }) },
        { updated: [AMY], public: true },
      ],
      [
        'a server held only by its placeholder',
        { getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: [GITHUB_TOKEN] }) },
        { updated: [AMY] },
      ],
      [
        'a tool that no longer exists',
        {
          getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: ['gone_mcp_tars_github'] }),
        },
        { updated: [AMY] },
      ],
      ['a change that only removes people', {}, { updated: [], removed: [AMY] }],
    ])('lets %s through without a check', async (_label, overrides, body) => {
      const checks = mockTars();

      const { next } = await runGuard(createDeps(overrides), body);

      expect(next).toHaveBeenCalledTimes(1);
      expect(checks).toEqual([]);
    });

    it('leaves every other resource alone', async () => {
      const fetch = jest.spyOn(global, 'fetch');
      const deps = createDeps();

      const { next } = await runGuard(deps, { public: true }, ResourceType.PROMPTGROUP);

      expect(next).toHaveBeenCalledTimes(1);
      expect(deps.getAgent).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does nothing without pwc_tars', async () => {
      delete process.env.TARS_AUTH_URL;
      const deps = createDeps();

      const { next } = await runGuard(deps, { updated: [AMY] });

      expect(next).toHaveBeenCalledTimes(1);
      expect(deps.getAgent).not.toHaveBeenCalled();
    });
  });

  describe('refuseAddedTools', () => {
    const agent = { _id: 'a1', author: 'author-id', tools: [LIST_REPOS] };
    const entries = [
      { principalType: PrincipalType.USER, principalId: 'author-id' },
      { principalType: PrincipalType.USER, principalId: 'u1' },
      { principalType: PrincipalType.GROUP, principalId: 'mongo-g1' },
    ];
    const deps = (acl: unknown[] = entries) =>
      createDeps({
        findEntriesByResource: jest
          .fn()
          .mockImplementation(async (resourceType: string) =>
            resourceType === ResourceType.AGENT ? acl : [],
          ),
        findUsersByIds: jest
          .fn()
          .mockResolvedValue([{ _id: 'u1', username: 'amy', idOnTheSource: 'amy' }]),
        findGroupsByIds: jest
          .fn()
          .mockResolvedValue([{ _id: 'mongo-g1', name: 'UAT', idOnTheSource: 'g1' }, null]),
      });

    it('checks the added tools against everyone shared, except the author', async () => {
      const checks = mockTars([
        { principal_type: 'group', principal_id: 'g1', servers: [{ ...GAP, tool_names: [] }] },
      ]);
      const shareDeps = deps();

      const refusal = await createTarsAgentShare(shareDeps).refuseAddedTools(agent, [
        LIST_REPOS,
        GET_FILE,
      ]);

      expect(shareDeps.findUsersByIds).toHaveBeenCalledWith(['u1']);
      expect(checks).toEqual([
        {
          principals: [
            { principal_type: 'user', principal_id: 'amy' },
            { principal_type: 'group', principal_id: 'g1' },
          ],
          servers: [{ mcp_server_id: 's-github', mcp_tool_ids: ['t-file'] }],
        },
      ]);
      expect(refusal?.body).toEqual(
        expect.objectContaining({
          code: TARS_MCP_SHARE_BLOCKED,
          blocked: [expect.objectContaining({ idOnTheSource: 'g1', name: 'UAT' })],
        }),
      );
    });

    it('refuses adding a tool to an agent shared with everyone', async () => {
      const checks = mockTars();

      const refusal = await createTarsAgentShare(
        deps([...entries, { principalType: PrincipalType.PUBLIC }]),
      ).refuseAddedTools(agent, [GET_FILE]);

      expect(refusal?.body.code).toBe(TARS_MCP_PUBLIC_SHARE_BLOCKED);
      expect(checks).toEqual([]);
    });

    it('ignores an edit that adds no gateway tool', async () => {
      const shareDeps = deps();

      await expect(
        createTarsAgentShare(shareDeps).refuseAddedTools(agent, [LIST_REPOS, 'web_search']),
      ).resolves.toBeNull();
      expect(shareDeps.findEntriesByResource).not.toHaveBeenCalled();
    });

    it('allows anything on an agent nobody else has', async () => {
      const checks = mockTars();

      await expect(
        createTarsAgentShare(
          deps([{ principalType: PrincipalType.USER, principalId: 'author-id' }]),
        ).refuseAddedTools(agent, [GET_FILE]),
      ).resolves.toBeNull();
      expect(checks).toEqual([]);
    });
  });
});
