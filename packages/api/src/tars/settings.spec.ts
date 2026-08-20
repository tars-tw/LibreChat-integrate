jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  importTarsLicense,
  fetchTarsSystemLogo,
  uploadTarsSystemLogo,
  removeTarsSystemLogo,
  fetchTarsSystemSettings,
} from './settings';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const buildBinaryResponse = (status: number, bytes: Uint8Array, contentType = 'image/png') =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => contentType },
    arrayBuffer: async () => bytes.buffer,
  }) as unknown as Response;

const file = { buffer: Buffer.from('logo'), filename: 'logo.png', mimetype: 'image/png' };

describe('fetchTarsSystemSettings', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('mirrors the licence fields from prepare_data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        license_status: 'activate',
        license_start_date: '2026-01-01',
        license_end_date: '2027-01-01',
        system_title: 'ignored',
      }),
    );

    await expect(fetchTarsSystemSettings(BASE_URL)).resolves.toEqual({
      licenseStatus: 'activate',
      licenseStartDate: '2026-01-01',
      licenseEndDate: '2027-01-01',
    });
  });

  it('treats a bare response as not activated', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsSystemSettings(BASE_URL)).resolves.toEqual({
      licenseStatus: 'inactivate',
      licenseStartDate: '',
      licenseEndDate: '',
    });
  });
});

describe('uploadTarsSystemLogo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** pwc_tars rejects the request outright when `settings` is empty. */
  it('sends a non-empty settings array alongside the file', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await uploadTarsSystemLogo('admin', 'ada', file, BASE_URL);

    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/settings/update_sys_settings`);
    expect(form.get('user_id')).toBe('admin');
    expect(form.get('username')).toBe('ada');
    expect(JSON.parse(form.get('settings') as string)).toHaveLength(1);
    expect(form.get('system_logo')).toBeInstanceOf(Blob);
  });

  it('throws when pwc_tars rejects the upload', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(400, {}));
    await expect(uploadTarsSystemLogo('admin', 'ada', file, BASE_URL)).rejects.toThrow();
  });
});

describe('removeTarsSystemLogo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes the operator as a query param', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await removeTarsSystemLogo('admin', BASE_URL);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/settings/remove_system_logo?user_id=admin`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('fetchTarsSystemLogo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the bytes and content type of the stored logo', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildBinaryResponse(200, new Uint8Array([1, 2, 3])));

    const logo = await fetchTarsSystemLogo(BASE_URL);

    expect(logo?.contentType).toBe('image/png');
    expect(logo?.buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  /** No logo uploaded is a normal state, not a failure. */
  it('returns null for a missing or empty logo', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildBinaryResponse(404, new Uint8Array()));
    await expect(fetchTarsSystemLogo(BASE_URL)).resolves.toBeNull();

    jest.spyOn(global, 'fetch').mockResolvedValue(buildBinaryResponse(200, new Uint8Array()));
    await expect(fetchTarsSystemLogo(BASE_URL)).resolves.toBeNull();
  });
});

describe('importTarsLicense', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The status arrives wrapped on some pwc_tars builds and bare on others. */
  it('accepts both the wrapped and the bare licence status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        license_data: { start_date: '2026-01-01', end_date: '2027-01-01' },
        license_status: { license_status: 'activate' },
      }),
    );
    await expect(
      importTarsLicense({ ...file, filename: 'license.key' }, BASE_URL),
    ).resolves.toEqual({
      licenseStatus: 'activate',
      licenseStartDate: '2026-01-01',
      licenseEndDate: '2027-01-01',
    });

    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        license_data: { start_date: '2026-02-01', end_date: '2027-02-01' },
        license_status: 'expired',
      }),
    );
    await expect(
      importTarsLicense({ ...file, filename: 'license.key' }, BASE_URL),
    ).resolves.toMatchObject({ licenseStatus: 'expired' });
  });

  it('surfaces the pwc_tars error message on a rejected file', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { error: 'Invalid file type' }));
    await expect(importTarsLicense(file, BASE_URL)).rejects.toThrow('Invalid file type');
  });
});
