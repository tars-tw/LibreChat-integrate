jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { fetchTarsWebsites, deleteTarsWebsite } from './websites';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance, call = 0): string =>
  String(fetchMock.mock.calls[call][0]);

const websiteRow = {
  id: 'w-1',
  name: 'Docs',
  url: 'https://example.com/docs',
  status: 1,
  word_count: 1200,
  tokens: 900,
  knowledge_base_id: 'kb-1',
  knowledge_base_name: '客服知識庫',
};

afterEach(() => jest.restoreAllMocks());

describe('fetchTarsWebsites', () => {
  it('returns the rows and the import targets from one request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        dataset_websites: [websiteRow],
        knowledge_bases: [{ id: 'kb-1', name: '客服知識庫' }, { name: 'no id' }],
      }),
    );

    const result = await fetchTarsWebsites(BASE_URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.websites[0].knowledge_base_name).toBe('客服知識庫');
    /** A target with no id could never be imported into; drop it. */
    expect(result.knowledgeBases).toEqual([{ id: 'kb-1', name: '客服知識庫' }]);
  });
});

describe('deleteTarsWebsite', () => {
  it('clears the chunks and vectors of a bound row', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'deleted' }));

    await deleteTarsWebsite('user-1', 'w-1', 'kb-1', BASE_URL);

    expect(urlOf(fetchMock)).toContain('/api/knowledge_detail/delete_dataset_website');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      user_id: 'user-1',
      knowledge_base_id: 'kb-1',
      dataset_website_id: 'w-1',
    });
  });

  it('deletes an unbound row through the master endpoint', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'deleted' }));

    await deleteTarsWebsite('user-1', 'w-1', null, BASE_URL);

    expect(urlOf(fetchMock)).toContain(
      '/api/dataset_website/delete_dataset_website/w-1?operator_id=user-1',
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
