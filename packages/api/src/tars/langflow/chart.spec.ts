jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { createTarsChartTool } from './chart';

const BASE_URL = 'http://tars.test';
const CHART_URL = 'http://tars.test/static/quickchart/default/chart_1_abc.png';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const mockBackend = (chart: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/langflow-service/chart')) {
      return buildResponse(chart.status, chart.body);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }, { model_name: 'gpt-5.5' }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createTarsChartTool', () => {
  it('appends the chart image when the answer does not embed it', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { answer: '已完成', chart_url: CHART_URL } },
    });
    const chartTool = createTarsChartTool({ model: 'gpt-5.4-mini' });

    await expect(chartTool.invoke({ request: '畫柱狀圖：1月120、2月95' })).resolves.toBe(
      `已完成\n\n![chart](${CHART_URL})`,
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/chart'),
    );
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      query: '畫柱狀圖：1月120、2月95',
      model_name: 'gpt-5.4-mini',
    });
  });

  it('keeps the answer untouched when the image is already embedded', async () => {
    const answer = `這是圖表：![chart](${CHART_URL})`;
    mockBackend({
      status: 200,
      body: { success: true, data: { answer, chart_url: CHART_URL } },
    });
    const chartTool = createTarsChartTool({});
    await expect(chartTool.invoke({ request: 'q' })).resolves.toBe(answer);
  });

  it('returns the bare answer when pwc_tars produced no chart', async () => {
    mockBackend({
      status: 200,
      body: { success: true, data: { answer: '沒有可畫的數據', chart_url: '' } },
    });
    const chartTool = createTarsChartTool({});
    await expect(chartTool.invoke({ request: 'q' })).resolves.toBe('沒有可畫的數據');
  });

  it('reports the pwc_tars failure instead of throwing into the agent loop', async () => {
    mockBackend({ status: 500, body: { message: '圖表產生失敗' } });
    const chartTool = createTarsChartTool({});
    await expect(chartTool.invoke({ request: 'q' })).resolves.toBe(
      'Chart generation failed: 圖表產生失敗',
    );
  });
});
