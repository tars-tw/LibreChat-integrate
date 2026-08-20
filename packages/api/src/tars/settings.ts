import type { TarsUploadFile } from './knowledge';
import { tarsFetch, getTarsBaseUrl } from './client';

/**
 * The pwc_tars system settings LibreChat surfaces. pwc_tars returns the whole
 * `category='system'` config block; only the licence fields are mirrored here
 * because every other value is edited on the system-parameter page instead.
 */
export interface TarsSystemSettings {
  licenseStatus: string;
  licenseStartDate: string;
  licenseEndDate: string;
}

interface PrepareDataResponse {
  license_status?: string;
  license_start_date?: string;
  license_end_date?: string;
}

export async function fetchTarsSystemSettings(baseUrl?: string): Promise<TarsSystemSettings> {
  const data = await tarsFetch<PrepareDataResponse>('/api/settings/prepare_data', { baseUrl });
  return {
    licenseStatus: data?.license_status ?? 'inactivate',
    licenseStartDate: data?.license_start_date ?? '',
    licenseEndDate: data?.license_end_date ?? '',
  };
}

const toBlob = (file: TarsUploadFile): Blob =>
  new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });

/**
 * Uploads the system logo through pwc_tars' own settings endpoint, so pwc_tars
 * 1.0 keeps working unchanged. `update_sys_settings` rejects a request whose
 * `settings` array is empty, so the `SYS_LOGO` row pwc_tars sets anyway is sent
 * alongside the file to satisfy that check.
 */
export async function uploadTarsSystemLogo(
  tarsId: string,
  username: string,
  file: TarsUploadFile,
  baseUrl?: string,
): Promise<void> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/settings/update_sys_settings`;
  const form = new FormData();
  form.append('user_id', tarsId);
  form.append('username', username);
  form.append(
    'settings',
    JSON.stringify([{ key: 'SYS_LOGO', value: 'true', description: 'System logo uploaded' }]),
  );
  form.append('system_logo', toBlob(file), file.filename);

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`pwc_tars system logo upload returned status ${response.status}`);
  }
}

export async function removeTarsSystemLogo(tarsId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/settings/remove_system_logo', { query: { user_id: tarsId }, baseUrl });
}

/**
 * The stored system logo as raw bytes. pwc_tars serves it as a static file, and
 * LibreChat proxies it so the browser never needs to reach pwc_tars directly.
 * Returns null when no logo has been uploaded, which is not an error.
 */
export async function fetchTarsSystemLogo(
  baseUrl?: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const url = `${getTarsBaseUrl(baseUrl)}/static/images/system_logo.png`;
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`pwc_tars system logo request returned status ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    return null;
  }
  return { buffer, contentType: response.headers.get('content-type') ?? 'image/png' };
}

export interface TarsLicenseResult {
  licenseStatus: string;
  licenseStartDate: string;
  licenseEndDate: string;
}

interface ImportLicenseResponse {
  license_data?: { start_date?: string; end_date?: string };
  license_status?: { license_status?: string } | string;
}

/**
 * Uploads a `.key` licence file. pwc_tars decrypts it, writes the licence rows
 * and answers with the new validity window; the status arrives either as a bare
 * string or wrapped in an object depending on the pwc_tars build.
 */
export async function importTarsLicense(
  file: TarsUploadFile,
  baseUrl?: string,
): Promise<TarsLicenseResult> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/settings/import_license`;
  const form = new FormData();
  form.append('file', toBlob(file), file.filename);

  const response = await fetch(url, { method: 'POST', body: form });
  const body = (await response.json().catch(() => ({}))) as ImportLicenseResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body?.error ?? `pwc_tars licence import returned status ${response.status}`);
  }

  const status =
    typeof body.license_status === 'string'
      ? body.license_status
      : (body.license_status?.license_status ?? 'activate');
  return {
    licenseStatus: status,
    licenseStartDate: body.license_data?.start_date ?? '',
    licenseEndDate: body.license_data?.end_date ?? '',
  };
}
