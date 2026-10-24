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
import { listTarsPluginCatalog } from './catalog';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const mockBackend = (options: { manifestsStatus?: number } = {}) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/settings/list_sys_configs')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.endsWith('/api/langflow-service/tools')) {
      return buildResponse(options.manifestsStatus ?? 200, {
        success: true,
        data: {
          tools: [
            { name: 'tars_knowledge_search', kind: 'builtin', description: 'Search.' },
            {
              name: 'text_stats',
              kind: 'plugin',
              display_name: 'Text Stats',
              description: 'Count.',
            },
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

describe('listTarsPluginCatalog', () => {
  it('lists every loaded plugin as an agent-builder tool, built-ins left out', async () => {
    mockBackend();
    await expect(listTarsPluginCatalog('u1')).resolves.toEqual([
      {
        name: 'Text Stats',
        pluginKey: 'tars_plugin_text_stats',
        description: 'Count.',
        authConfig: [],
      },
      {
        name: 'summarize_text',
        pluginKey: 'tars_plugin_summarize_text',
        description: 'Summarize.',
        authConfig: [],
      },
    ]);
  });

  it('lists nothing to an unlinked account or without pwc_tars', async () => {
    const fetchMock = mockBackend();
    await expect(listTarsPluginCatalog(undefined)).resolves.toEqual([]);
    delete process.env.TARS_AUTH_URL;
    await expect(listTarsPluginCatalog('u1')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists nothing while pwc_tars is down', async () => {
    mockBackend({ manifestsStatus: 503 });
    await expect(listTarsPluginCatalog('u1')).resolves.toEqual([]);
  });
});
