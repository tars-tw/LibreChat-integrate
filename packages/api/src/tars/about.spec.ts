// Destination: packages/api/src/tars/about.spec.ts

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { fetchTarsReleaseNotes } from './about';
import type { TarsReleaseNote } from './about';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const note: TarsReleaseNote = {
  id: 'note-1',
  version: '1.4.0',
  title: 'September release',
  content: '## Highlights\n- Faster search',
  created_at: '2026-09-01T00:00:00Z',
  is_published: true,
};

describe('fetchTarsReleaseNotes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the status envelope', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { status: 'success', data: [note], count: 1 }));
    await expect(fetchTarsReleaseNotes(BASE_URL)).resolves.toEqual([note]);
  });

  it('requests only published notes', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { status: 'success', data: [], count: 0 }));
    await fetchTarsReleaseNotes(BASE_URL);
    expect(String(fetchMock.mock.calls[0][0])).toContain('is_published=true');
  });

  it('returns [] when the envelope status is not "success"', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { status: 'error', data: [note] }));
    await expect(fetchTarsReleaseNotes(BASE_URL)).resolves.toEqual([]);
  });

  it('returns [] when pwc_tars sends no data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { status: 'success' }));
    await expect(fetchTarsReleaseNotes(BASE_URL)).resolves.toEqual([]);
  });
});
