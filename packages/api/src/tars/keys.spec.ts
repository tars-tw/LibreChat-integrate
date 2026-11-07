jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { TPlugin } from 'librechat-data-provider';
import { withTarsToolKeys, loadTarsToolAuthValues } from './keys';
import { invalidateTarsSysConfigCache } from './sysconfig';

const imageTool: TPlugin = {
  name: 'OpenAI Image Tools',
  pluginKey: 'image_gen_oai',
  toolkit: true,
  description: 'Image Generation and Editing',
  authConfig: [{ authField: 'IMAGE_GEN_OAI_API_KEY', label: 'Key', description: 'Key' }],
};

const otherTool: TPlugin = {
  name: 'Wolfram',
  pluginKey: 'wolfram',
  authConfig: [{ authField: 'WOLFRAM_APP_ID', label: 'App ID', description: 'App ID' }],
};

const respondWith = (rows: Array<{ key: string; value: string | null; status?: string }>) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => rows.map((row) => ({ status: 'active', ...row })),
  } as Response);

beforeEach(() => {
  process.env.TARS_AUTH_URL = 'http://tars.test';
  invalidateTarsSysConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
  delete process.env.IMAGE_GEN_OAI_API_KEY;
});

describe('withTarsToolKeys', () => {
  it('drops the credential form and marks the tool authenticated when the key is set', async () => {
    respondWith([{ key: 'KEY_OPEN_AI_API', value: 'sk-live' }]);

    const [image, other] = await withTarsToolKeys([imageTool, otherTool]);

    expect(image.authConfig).toBeUndefined();
    expect(image.authenticated).toBe(true);
    expect(image.missingKeyProvider).toBeUndefined();
    expect(other).toBe(otherTool);
  });

  it.each([
    ['unset', []],
    ['DEFAULT', [{ key: 'KEY_OPEN_AI_API', value: 'DEFAULT' }]],
    ['inactive', [{ key: 'KEY_OPEN_AI_API', value: 'sk-live', status: 'inactive' }]],
  ])('names the provider when the key is %s, whatever env holds', async (_label, rows) => {
    process.env.IMAGE_GEN_OAI_API_KEY = 'sk-env';
    respondWith(rows);

    const [image] = await withTarsToolKeys([{ ...imageTool, authenticated: true }]);

    expect(image.authConfig).toBeUndefined();
    expect(image.authenticated).toBeUndefined();
    expect(image.missingKeyProvider).toBe('OpenAI');
  });

  it('leaves the listing untouched while pwc_tars is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const tools = [imageTool, otherTool];

    await expect(withTarsToolKeys(tools)).resolves.toBe(tools);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('loadTarsToolAuthValues', () => {
  it('hands the 模型金鑰管理 key to the tool under its manifest auth field', async () => {
    process.env.IMAGE_GEN_OAI_API_KEY = 'sk-env';
    respondWith([{ key: 'KEY_OPEN_AI_API', value: ' sk-live ' }]);

    await expect(loadTarsToolAuthValues('image_gen_oai')).resolves.toEqual({
      IMAGE_GEN_OAI_API_KEY: 'sk-live',
    });
  });

  it('throws when the key is unset rather than falling back to env', async () => {
    process.env.IMAGE_GEN_OAI_API_KEY = 'sk-env';
    respondWith([]);

    await expect(loadTarsToolAuthValues('image_gen_oai')).rejects.toThrow('KEY_OPEN_AI_API');
  });

  it('returns undefined for other tools and while pwc_tars is unconfigured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(loadTarsToolAuthValues('wolfram')).resolves.toBeUndefined();
    delete process.env.TARS_AUTH_URL;
    await expect(loadTarsToolAuthValues('image_gen_oai')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
