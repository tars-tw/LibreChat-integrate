jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { invalidateTarsPluginManifestsCache } from './client';
import { allowedTarsPluginNames, resolveTarsPluginToolNames } from './domain';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const functions = JSON.stringify({
  web_search: { enabled: true, default_value: true },
  'plugin:text_stats': { kind: 'plugin', name: 'text_stats', enabled: true, default_value: true },
  'plugin:summarize_text': { kind: 'plugin', name: 'summarize_text', enabled: false },
  'plugin:ghost_tool': { kind: 'plugin', name: 'ghost_tool', enabled: true },
});

const mockBackend = (options: { manifestsStatus?: number } = {}) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [
          { id: 100, name: '通用腦', domain_functions: functions },
          { id: 235, name: '無外掛腦', domain_functions: '{"web_search":{"enabled":true}}' },
        ],
      });
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.endsWith('/api/langflow-service/tools')) {
      return buildResponse(options.manifestsStatus ?? 200, {
        success: true,
        data: {
          tools: [
            { name: 'text_stats', kind: 'plugin', description: 'Count.' },
            { name: 'summarize_text', kind: 'plugin', description: 'Summarize.' },
          ],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  invalidateTarsPluginManifestsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('allowedTarsPluginNames', () => {
  it('lists the plugins the brain switched on', async () => {
    mockBackend();
    await expect(allowedTarsPluginNames({ tarsUserId: 'u1', domainId: 100 })).resolves.toEqual(
      new Set(['text_stats', 'ghost_tool']),
    );
  });

  it('allows nothing without a user, without a brain, or outside the user grants', async () => {
    const fetchMock = mockBackend();
    await expect(allowedTarsPluginNames({ domainId: 100 })).resolves.toEqual(new Set());
    await expect(allowedTarsPluginNames({ tarsUserId: 'u1' })).resolves.toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(allowedTarsPluginNames({ tarsUserId: 'u1', domainId: 999 })).resolves.toEqual(
      new Set(),
    );
  });
});

describe('resolveTarsPluginToolNames', () => {
  const requested = [
    'tars_plugin_text_stats',
    'tars_plugin_summarize_text',
    'tars_plugin_ghost_tool',
    'sql_agent',
  ];

  it('keeps plugin tools the brain offers and pwc_tars has loaded', async () => {
    mockBackend();
    await expect(
      resolveTarsPluginToolNames(requested, { tarsUserId: 'u1', domainId: '100' }),
    ).resolves.toEqual(new Set(['tars_plugin_text_stats']));
  });

  it('resolves nothing for a brain without plugins', async () => {
    mockBackend();
    await expect(
      resolveTarsPluginToolNames(requested, { tarsUserId: 'u1', domainId: 235 }),
    ).resolves.toEqual(new Set());
  });

  it('skips pwc_tars entirely when no plugin tool was requested', async () => {
    const fetchMock = mockBackend();
    await expect(
      resolveTarsPluginToolNames(['sql_agent'], { tarsUserId: 'u1', domainId: 100 }),
    ).resolves.toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when pwc_tars cannot be asked', async () => {
    mockBackend({ manifestsStatus: 503 });
    await expect(
      resolveTarsPluginToolNames(requested, { tarsUserId: 'u1', domainId: 100 }),
    ).resolves.toEqual(new Set());
  });
});
