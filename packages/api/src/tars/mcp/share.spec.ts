jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { EventEmitter } from 'events';
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
import { clearTarsMcpEntryNames, recordTarsMcpDirectEntry } from './names';
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

const rawResponse = (body: unknown): Response =>
  ({ status: 200, ok: true, json: async () => body }) as unknown as Response;

const jsonResponse = (data: unknown): Response => rawResponse({ success: true, data });

/** Serves pwc_tars and records every MCP `share-check` body. */
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

/** Serves both pwc_tars checks and records each body by endpoint. */
const mockTarsWithKnowledge = ({
  mcpMissing = [] as unknown[],
  knowledgeMissing = [] as unknown[],
} = {}) => {
  const checks = { mcp: [] as unknown[], knowledge: [] as unknown[] };
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/mcp/available-tools') {
      return jsonResponse(ROWS);
    }
    if (url.pathname === '/api/mcp/share-check') {
      checks.mcp.push(JSON.parse(String(init?.body)));
      return jsonResponse({ missing: mcpMissing });
    }
    if (url.pathname === '/api/km_permission/share_check') {
      checks.knowledge.push(JSON.parse(String(init?.body)));
      return jsonResponse({ knowledge_bases: [], missing: knowledgeMissing });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return checks;
};

const ERP_GAP = { id: 'kb3', name: 'ERP' };

const createDeps = (overrides: Partial<TarsAgentShareDeps> = {}): TarsAgentShareDeps => ({
  getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: [LIST_REPOS] }),
  findEntriesByResource: jest.fn().mockResolvedValue([]),
  findUsersByIds: jest.fn().mockResolvedValue([]),
  findGroupsByIds: jest.fn().mockResolvedValue([]),
  directory: { get: jest.fn().mockResolvedValue({ users: [], groups: [] }) },
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

    it('asks for the whole server when the agent binds an OIDC server pwc_tars lists no tools for', async () => {
      const checks = mockTars();
      recordTarsMcpDirectEntry('tars_secure', 's-oidc');
      const deps = createDeps({
        getAgent: jest.fn().mockResolvedValue({ _id: 'a1', tools: ['whoami_mcp_tars_secure'] }),
      });

      const { next } = await runGuard(deps, { updated: [AMY] });

      expect(next).toHaveBeenCalledTimes(1);
      expect(checks[0].servers).toEqual([{ mcp_server_id: 's-oidc', mcp_tool_ids: [] }]);
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

    describe('with knowledge bases picked', () => {
      /** 知識庫檢索 and 資料庫查詢 are on; 產生圖表 is off, so its pick asks nothing. */
      const pickingAgent = (tools: string[] = ['tars_knowledge_search', 'tars_sql_query']) =>
        createDeps({
          getAgent: jest.fn().mockResolvedValue({
            _id: 'a1',
            tools,
            tars_knowledge_bases: {
              rag_agent: ['kb1', 'kb2'],
              sql_agent: ['kb3'],
              chart_agent: ['kb9'],
            },
          }),
        });

      it('asks pwc_tars about the picks of the switches that are on, and lets everyone through', async () => {
        const checks = mockTarsWithKnowledge();

        const { next } = await runGuard(pickingAgent(), { updated: [AMY, GROUP, AMY] });

        expect(next).toHaveBeenCalledTimes(1);
        expect(checks).toEqual({
          mcp: [],
          knowledge: [
            {
              knowledge_base_ids: ['kb1', 'kb2', 'kb3'],
              principals: [
                { principal_type: 'user', principal_id: 'amy' },
                { principal_type: 'group', principal_id: 'g1' },
              ],
            },
          ],
        });
      });

      it('refuses whoever may not use a picked knowledge base in chat', async () => {
        mockTarsWithKnowledge({
          knowledgeMissing: [
            { principal_type: 'group', principal_id: 'g1', knowledge_bases: [ERP_GAP] },
          ],
        });

        const { res, next } = await runGuard(pickingAgent(), { updated: [AMY, GROUP] });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: TARS_MCP_SHARE_BLOCKED,
            blocked: [
              {
                principal_type: 'group',
                idOnTheSource: 'g1',
                name: 'UAT',
                servers: [],
                knowledge_bases: [ERP_GAP],
              },
            ],
          }),
        );
      });

      it('lists the knowledge-base and MCP gaps of each person together', async () => {
        const checks = mockTarsWithKnowledge({
          mcpMissing: [
            {
              principal_type: 'user',
              principal_id: 'amy',
              servers: [{ ...GAP, tool_names: ['list_repos'] }],
            },
          ],
          knowledgeMissing: [
            { principal_type: 'user', principal_id: 'amy', knowledge_bases: [ERP_GAP] },
          ],
        });

        const { res } = await runGuard(pickingAgent([LIST_REPOS, 'tars_sql_query']), {
          updated: [AMY, GROUP],
        });

        expect(checks.mcp).toHaveLength(1);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            blocked: [
              {
                principal_type: 'user',
                idOnTheSource: 'amy',
                name: 'Amy',
                servers: [{ ...GAP, tool_names: ['list_repos'] }],
                knowledge_bases: [ERP_GAP],
              },
            ],
          }),
        );
      });

      it('refuses sharing an agent with picks with everyone', async () => {
        const checks = mockTarsWithKnowledge();

        const { res } = await runGuard(pickingAgent(), { public: true });

        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: TARS_MCP_PUBLIC_SHARE_BLOCKED }),
        );
        expect(checks.knowledge).toEqual([]);
      });

      it('asks nothing when no switch with picks is on', async () => {
        const checks = mockTarsWithKnowledge();

        const { next } = await runGuard(pickingAgent(['web_search']), { updated: [AMY] });

        expect(next).toHaveBeenCalledTimes(1);
        expect(checks).toEqual({ mcp: [], knowledge: [] });
      });

      it('still checks the knowledge bases with the MCP gateway turned off', async () => {
        const savedMcp = process.env.TARS_MCP_ENABLED;
        process.env.TARS_MCP_ENABLED = 'false';
        try {
          const checks = mockTarsWithKnowledge();

          await runGuard(pickingAgent([LIST_REPOS, 'tars_knowledge_search']), { updated: [AMY] });

          expect(checks.mcp).toEqual([]);
          expect(checks.knowledge).toHaveLength(1);
        } finally {
          if (savedMcp === undefined) {
            delete process.env.TARS_MCP_ENABLED;
          } else {
            process.env.TARS_MCP_ENABLED = savedMcp;
          }
        }
      });

      it('stays closed when pwc_tars cannot answer about the knowledge bases', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

        const { res, next } = await runGuard(pickingAgent(), { updated: [AMY] });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
      });
    });

    it('does nothing without pwc_tars', async () => {
      delete process.env.TARS_AUTH_URL;
      const deps = createDeps();

      const { next } = await runGuard(deps, { updated: [AMY] });

      expect(next).toHaveBeenCalledTimes(1);
      expect(deps.getAgent).not.toHaveBeenCalled();
    });
  });

  describe('refuseNewBindings', () => {
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

      const refusal = await createTarsAgentShare(shareDeps).refuseNewBindings(agent, {
        tools: [LIST_REPOS, GET_FILE],
      });

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
      ).refuseNewBindings(agent, { tools: [GET_FILE] });

      expect(refusal?.body.code).toBe(TARS_MCP_PUBLIC_SHARE_BLOCKED);
      expect(checks).toEqual([]);
    });

    it('ignores an edit that adds no gateway tool', async () => {
      const shareDeps = deps();

      await expect(
        createTarsAgentShare(shareDeps).refuseNewBindings(agent, {
          tools: [LIST_REPOS, 'web_search'],
        }),
      ).resolves.toBeNull();
      expect(shareDeps.findEntriesByResource).not.toHaveBeenCalled();
    });

    it('allows anything on an agent nobody else has', async () => {
      const checks = mockTars();

      await expect(
        createTarsAgentShare(
          deps([{ principalType: PrincipalType.USER, principalId: 'author-id' }]),
        ).refuseNewBindings(agent, { tools: [GET_FILE] }),
      ).resolves.toBeNull();
      expect(checks).toEqual([]);
    });

    describe('knowledge-base picks', () => {
      const picking = {
        ...agent,
        tools: [LIST_REPOS, 'tars_knowledge_search'],
        tars_knowledge_bases: { rag_agent: ['kb1'], sql_agent: ['kb3'] },
      };

      it.each<
        [
          string,
          Parameters<ReturnType<typeof createTarsAgentShare>['refuseNewBindings']>[1],
          string[],
        ]
      >([
        [
          'picks another knowledge base',
          { tars_knowledge_bases: { rag_agent: ['kb1', 'kb2'], sql_agent: ['kb3'] } },
          ['kb2'],
        ],
        [
          'turns on a switch whose picks were waiting',
          { tools: [LIST_REPOS, 'tars_knowledge_search', 'tars_sql_query'] },
          ['kb3'],
        ],
      ])('checks everyone shared when the save %s', async (_label, next, asked) => {
        const checks = mockTarsWithKnowledge({
          knowledgeMissing: [
            { principal_type: 'user', principal_id: 'amy', knowledge_bases: [ERP_GAP] },
          ],
        });

        const refusal = await createTarsAgentShare(deps()).refuseNewBindings(picking, next);

        expect(checks.knowledge).toEqual([
          {
            knowledge_base_ids: asked,
            principals: [
              { principal_type: 'user', principal_id: 'amy' },
              { principal_type: 'group', principal_id: 'g1' },
            ],
          },
        ]);
        expect(refusal?.body).toEqual(
          expect.objectContaining({
            code: TARS_MCP_SHARE_BLOCKED,
            blocked: [
              expect.objectContaining({
                idOnTheSource: 'amy',
                name: 'amy',
                knowledge_bases: [ERP_GAP],
              }),
            ],
          }),
        );
      });

      it.each<
        [string, Parameters<ReturnType<typeof createTarsAgentShare>['refuseNewBindings']>[1]]
      >([
        [
          'keeps the same picks',
          { tars_knowledge_bases: { rag_agent: ['kb1'], sql_agent: ['kb3'] } },
        ],
        ['does not send the picks', { tools: [LIST_REPOS, 'tars_knowledge_search'] }],
        ['drops a pick', { tars_knowledge_bases: { sql_agent: ['kb3'] } }],
        ['clears every pick', { tars_knowledge_bases: null }],
        [
          'picks for a switch that stays off',
          { tars_knowledge_bases: { rag_agent: ['kb1'], chart_agent: ['kb9'] } },
        ],
      ])('lets a save through that %s', async (_label, next) => {
        const shareDeps = deps();

        await expect(
          createTarsAgentShare(shareDeps).refuseNewBindings(picking, next),
        ).resolves.toBeNull();
        expect(shareDeps.findEntriesByResource).not.toHaveBeenCalled();
      });

      it('refuses a new pick on an agent shared with everyone', async () => {
        const checks = mockTarsWithKnowledge();

        const refusal = await createTarsAgentShare(
          deps([...entries, { principalType: PrincipalType.PUBLIC }]),
        ).refuseNewBindings(picking, { tars_knowledge_bases: { rag_agent: ['kb1', 'kb2'] } });

        expect(refusal?.body.code).toBe(TARS_MCP_PUBLIC_SHARE_BLOCKED);
        expect(checks.knowledge).toEqual([]);
      });

      it('checks the new picks and the added tools in one go', async () => {
        const checks = mockTarsWithKnowledge();

        await createTarsAgentShare(deps()).refuseNewBindings(picking, {
          tools: [LIST_REPOS, GET_FILE, 'tars_knowledge_search'],
          tars_knowledge_bases: { rag_agent: ['kb1', 'kb2'] },
        });

        expect(checks.mcp).toEqual([
          expect.objectContaining({
            servers: [{ mcp_server_id: 's-github', mcp_tool_ids: ['t-file'] }],
          }),
        ]);
        expect(checks.knowledge).toEqual([
          expect.objectContaining({ knowledge_base_ids: ['kb2'] }),
        ]);
      });
    });
  });

  describe('turning the MCP servers on for whoever it is shared with', () => {
    const github = (overrides: Record<string, unknown> = {}) => ({
      id: 's-github',
      name: 'Github-repo',
      code: 'github',
      type: 'external',
      is_enabled: true,
      user_enabled: false,
      requires_user_credentials: false,
      has_credentials: false,
      auth_type: 'none',
      login_fields: [],
      tool_config: {},
      tools: [
        { id: 't-list', name: 'list_repos', user_enabled: true },
        { id: 't-file', name: 'get_file', user_enabled: true },
      ],
      ...overrides,
    });
    const maps = (overrides: Record<string, unknown> = {}) => ({
      ...github(),
      id: 's-maps',
      name: 'Google Maps',
      code: 'maps',
      requires_user_credentials: true,
      tools: [{ id: 't-place', name: 'search_places', user_enabled: true }],
      ...overrides,
    });

    /** Serves My Tools per pwc_tars user and records every write. */
    const mockMyTools = (settingsByUser: Record<string, unknown[]>) => {
      const reads: string[] = [];
      const writes: unknown[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/mcp/available-tools') {
          return jsonResponse(ROWS);
        }
        if (url.pathname === '/api/mcp/user-settings' && init?.method === 'PUT') {
          writes.push(JSON.parse(String(init.body)));
          return jsonResponse({});
        }
        if (url.pathname === '/api/mcp/user-settings') {
          const userId = url.searchParams.get('user_id') ?? '';
          reads.push(userId);
          return jsonResponse(settingsByUser[userId] ?? []);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      return { reads, writes };
    };

    const agent = { _id: 'a1', author: 'author-id', tools: [LIST_REPOS, MAPS_ALL] };
    const deps = (overrides: Partial<TarsAgentShareDeps> = {}) =>
      createDeps({
        getAgent: jest.fn().mockResolvedValue(agent),
        findEntriesByResource: jest.fn().mockImplementation(async (resourceType: string) =>
          resourceType === ResourceType.AGENT
            ? [
                { principalType: PrincipalType.USER, principalId: 'author-id' },
                { principalType: PrincipalType.USER, principalId: 'u1' },
                { principalType: PrincipalType.GROUP, principalId: 'mongo-g1' },
              ]
            : [],
        ),
        findUsersByIds: jest
          .fn()
          .mockResolvedValue([{ _id: 'u1', username: 'amy', idOnTheSource: 'amy' }]),
        findGroupsByIds: jest
          .fn()
          .mockResolvedValue([{ _id: 'mongo-g1', name: 'UAT', idOnTheSource: 'g1' }]),
        directory: {
          get: jest.fn().mockResolvedValue({
            users: [],
            groups: [{ id: 'g1', name: 'UAT', memberIds: ['bob', 'cat'] }],
          }),
        },
        ...overrides,
      });

    /** Lets the background work a `finish` starts run to completion. */
    const settle = async () => {
      for (let round = 0; round < 30; round += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    const share = async (
      shareDeps: TarsAgentShareDeps,
      body: unknown,
      { statusCode = 200, resourceType = ResourceType.AGENT as string } = {},
    ) => {
      const res = Object.assign(new EventEmitter(), { statusCode });
      const next = jest.fn() as NextFunction;
      const req = { params: { resourceType, resourceId: 'a1' }, body } as unknown as Request;
      createTarsAgentShare(shareDeps).enableOnShare(req, res as unknown as ExpressResponse, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.emit('finish');
      await settle();
    };

    describe('enableOnShare', () => {
      it('turns the servers on for the person added, keeping a credentialed one off', async () => {
        const { reads, writes } = mockMyTools({
          amy: [github({ tool_config: { list_repos: false, get_file: false } }), maps()],
        });

        await share(deps(), { updated: [AMY] });

        expect(reads).toEqual(['amy']);
        expect(writes).toEqual([
          {
            user_id: 'amy',
            server_id: 's-github',
            is_enabled: true,
            tool_config: { get_file: false },
          },
        ]);
      });

      it('reaches a group through its active members', async () => {
        const { reads, writes } = mockMyTools({
          bob: [github(), maps({ has_credentials: true, tool_config: { search_places: false } })],
        });

        await share(deps(), { updated: [GROUP] });

        expect(reads.sort()).toEqual(['bob', 'cat']);
        expect(writes).toEqual([
          { user_id: 'bob', server_id: 's-github', is_enabled: true },
          { user_id: 'bob', server_id: 's-maps', is_enabled: true, tool_config: {} },
        ]);
      });

      it('writes nothing for someone already set up', async () => {
        const { writes } = mockMyTools({ amy: [github({ user_enabled: true })] });

        await share(deps(), { updated: [AMY] });

        expect(writes).toEqual([]);
      });

      it('writes nothing when the share was not saved', async () => {
        const { reads } = mockMyTools({ amy: [github()] });

        await share(deps(), { updated: [AMY] }, { statusCode: 409 });

        expect(reads).toEqual([]);
      });

      it('takes only people the saved share holds, by their stored pwc_tars id', async () => {
        const { reads } = mockMyTools({});
        const stranger = { type: PrincipalType.USER, idOnTheSource: 'mallory', name: 'M' };

        await share(deps(), { updated: [stranger] });

        expect(reads).toEqual([]);
      });

      it('leaves other resources alone', async () => {
        const shareDeps = deps();
        mockMyTools({});

        await share(shareDeps, { updated: [AMY] }, { resourceType: ResourceType.PROMPTGROUP });

        expect(shareDeps.getAgent).not.toHaveBeenCalled();
      });

      it('does nothing with the MCP gateway turned off', async () => {
        process.env.TARS_MCP_ENABLED = 'false';
        const shareDeps = deps();
        try {
          await share(shareDeps, { updated: [AMY] });
        } finally {
          delete process.env.TARS_MCP_ENABLED;
        }

        expect(shareDeps.getAgent).not.toHaveBeenCalled();
      });
    });

    describe('enableNewBindings', () => {
      const saved = { ...agent, tools: [LIST_REPOS] };

      it('turns on only what the change added, for everyone shared except the author', async () => {
        const { reads, writes } = mockMyTools({
          amy: [github(), maps()],
          bob: [github(), maps({ has_credentials: true })],
        });

        await createTarsAgentShare(deps()).enableNewBindings(saved, [LIST_REPOS, MAPS_ALL]);

        expect(reads.sort()).toEqual(['amy', 'bob', 'cat']);
        expect(writes).toEqual([{ user_id: 'bob', server_id: 's-maps', is_enabled: true }]);
      });

      it('reads nothing when no gateway tool was added', async () => {
        const shareDeps = deps();
        mockMyTools({});

        await createTarsAgentShare(shareDeps).enableNewBindings(saved, [LIST_REPOS, 'web_search']);

        expect(shareDeps.findEntriesByResource).not.toHaveBeenCalled();
      });

      it('never rejects when pwc_tars cannot answer', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

        await expect(
          createTarsAgentShare(deps()).enableNewBindings(saved, [GET_FILE]),
        ).resolves.toBeUndefined();
      });
    });
  });
});
