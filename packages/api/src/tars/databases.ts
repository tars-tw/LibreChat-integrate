import { TARS_DEFAULT_PORTS, isTarsFileDatabase } from 'librechat-data-provider';
import type { TTarsDatabaseType } from 'librechat-data-provider';
import type { TarsDatasetDatabase, TarsRawDatabase } from './datasets';
import { getTarsBaseUrl, tarsFetch, TarsRequestError } from './client';
import { toSafeDatabase } from './datasets';

/**
 * Connecting to a customer database and listing its tables is a real network
 * round trip through pwc_tars, which the default 15s client timeout cuts short.
 */
const CONNECT_TIMEOUT_MS = 60000;

/** Uploading a SQLite file writes it to the pwc_tars share before it answers. */
const UPLOAD_TIMEOUT_MS = 120000;

export interface TarsDatabaseInput {
  name: string;
  description?: string;
  dbType: TTarsDatabaseType;
  host?: string;
  port?: number;
  /** For Oracle this is the Service Name; pwc_tars stores it in `database_name`. */
  databaseName?: string;
  /** Omitted or empty on update means "keep the stored account". */
  username?: string;
  /** Omitted or empty on update means "keep the stored password". */
  password?: string;
  enabled?: boolean;
  allowedKmIds?: string[];
}

export interface TarsSqliteUploadInput {
  name: string;
  description?: string;
  allowedKmIds?: string[];
}

export interface TarsUploadedFile {
  buffer: Buffer | Uint8Array;
  filename: string;
  mimetype?: string;
}

/** What `POST /api/dataset_sql/test_connection` reports back. */
export interface TarsDatabaseConnectionTest {
  tables: string[];
  views: string[];
}

interface DatasetListResponse {
  dataset_sqls?: TarsRawDatabase[];
}

interface DatasetMutationResponse {
  dataset?: TarsRawDatabase;
}

interface ConnectionTestResponse {
  data?: { tables?: string[]; views?: string[] };
  tables?: string[];
  views?: string[];
}

/**
 * Every connection, credentials stripped.
 * (`GET /api/dataset_sql/get_dataset_sqls`.)
 */
export async function fetchTarsDatabases(baseUrl?: string): Promise<TarsDatasetDatabase[]> {
  const data = await tarsFetch<DatasetListResponse>('/api/dataset_sql/get_dataset_sqls', {
    baseUrl,
  });
  return (data?.dataset_sqls ?? []).map(toSafeDatabase);
}

/**
 * The stored row *with* its password. Server-side only: it exists so an update
 * or a connection test can reuse a password the browser was never given, and
 * its result must never be returned to a client unfiltered.
 */
async function fetchRawDatabase(
  databaseId: string,
  baseUrl?: string,
): Promise<TarsRawDatabase | null> {
  const data = await tarsFetch<DatasetListResponse>('/api/dataset_sql/get_dataset_sqls', {
    query: { id: databaseId },
    baseUrl,
  });
  return data?.dataset_sqls?.[0] ?? null;
}

/**
 * pwc_tars' `update_dataset` writes every column it reads from the body, so an
 * omitted field lands as NULL on a NOT NULL column. Both mutations therefore
 * always send the complete row.
 */
const connectionBody = (
  input: TarsDatabaseInput,
  credentials: { username: string; password: string },
) => ({
  name: input.name,
  description: input.description ?? '',
  db_type: input.dbType,
  host: input.host ?? '',
  port: input.port ?? TARS_DEFAULT_PORTS[input.dbType] ?? 0,
  database_name: input.databaseName ?? '',
  username: credentials.username,
  password: credentials.password,
  status: input.enabled === false ? 0 : 1,
  allowed_km_ids: input.allowedKmIds ?? [],
});

/** A blank credential field falls back to what pwc_tars already has stored. */
const storedCredentials = (
  input: Pick<TarsDatabaseInput, 'username' | 'password'>,
  stored: TarsRawDatabase,
): { username: string; password: string } => ({
  username:
    input.username != null && input.username !== '' ? input.username : (stored.username ?? ''),
  password:
    input.password != null && input.password !== '' ? input.password : (stored.password ?? ''),
});

export async function createTarsDatabase(
  tarsId: string,
  input: TarsDatabaseInput,
  baseUrl?: string,
): Promise<TarsDatasetDatabase | null> {
  const response = await tarsFetch<DatasetMutationResponse>('/api/dataset_sql/create_dataset_sql', {
    method: 'POST',
    body: {
      ...connectionBody(input, {
        username: input.username ?? '',
        password: input.password ?? '',
      }),
      created_by: tarsId,
    },
    baseUrl,
  });
  return response?.dataset != null ? toSafeDatabase(response.dataset) : null;
}

/**
 * Edits a connection.
 *
 * The account and password are never sent to the browser, so a blank field
 * means "keep what is stored" rather than "clear it" — pwc_tars overwrites
 * every column it reads, and both are NOT NULL. A SQLite row also keeps its
 * uploaded file: there is no endpoint to replace one, so only the name,
 * description, status and knowledge-base grants are editable there.
 */
export async function updateTarsDatabase(
  tarsId: string,
  databaseId: string,
  input: TarsDatabaseInput,
  baseUrl?: string,
): Promise<TarsDatasetDatabase | null> {
  const stored = await fetchRawDatabase(databaseId, baseUrl);
  if (stored == null) {
    throw new TarsRequestError(404, '/api/dataset_sql/get_dataset_sqls', 'Database not found');
  }

  const merged: TarsDatabaseInput = isTarsFileDatabase(stored.db_type)
    ? {
        ...input,
        dbType: stored.db_type as TTarsDatabaseType,
        host: stored.host ?? '',
        port: stored.port ?? 1,
        databaseName: stored.database_name ?? '',
      }
    : input;

  const credentials = storedCredentials(input, stored);

  const response = await tarsFetch<DatasetMutationResponse>(
    `/api/dataset_sql/update_dataset/${encodeURIComponent(databaseId)}`,
    {
      method: 'PUT',
      body: { ...connectionBody(merged, credentials), updated_by: tarsId },
      baseUrl,
    },
  );
  return response?.dataset != null ? toSafeDatabase(response.dataset) : null;
}

export async function deleteTarsDatabase(
  tarsId: string,
  databaseId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/dataset_sql/delete_dataset/${encodeURIComponent(databaseId)}`, {
    method: 'DELETE',
    query: { operator_id: tarsId },
    baseUrl,
  });
}

/**
 * Opens the connection and lists its tables and views
 * (`POST /api/dataset_sql/test_connection`).
 *
 * `databaseId` lets an edit form test with the stored credentials still hidden:
 * pass the id and leave the account or password blank. Oracle needs
 * `service_name` in the test body even though the column it is finally stored
 * in is `database_name`.
 */
export async function testTarsDatabaseConnection(
  input: TarsDatabaseInput & { databaseId?: string },
  baseUrl?: string,
): Promise<TarsDatabaseConnectionTest> {
  let credentials = { username: input.username ?? '', password: input.password ?? '' };
  const needsStored = credentials.username === '' || credentials.password === '';
  if (needsStored && input.databaseId != null && input.databaseId !== '') {
    const stored = await fetchRawDatabase(input.databaseId, baseUrl);
    if (stored != null) {
      credentials = storedCredentials(input, stored);
    }
  }

  const body: Record<string, unknown> = {
    db_type: input.dbType,
    host: input.host ?? '',
    port: input.port ?? TARS_DEFAULT_PORTS[input.dbType] ?? 0,
    database_name: input.databaseName ?? '',
    username: credentials.username,
    password: credentials.password,
  };
  if (input.dbType === 'Oracle') {
    body.service_name = input.databaseName ?? '';
  }

  const response = await tarsFetch<ConnectionTestResponse>('/api/dataset_sql/test_connection', {
    method: 'POST',
    body,
    timeoutMs: CONNECT_TIMEOUT_MS,
    baseUrl,
  });

  return {
    tables: response?.data?.tables ?? response?.tables ?? [],
    views: response?.data?.views ?? response?.views ?? [],
  };
}

/**
 * Uploads a SQLite file as a new connection
 * (`POST /api/dataset_sql/upload_sqlite`). pwc_tars parses it as
 * `multipart/form-data` and expects `allowed_km_ids` as a JSON string, so this
 * posts a form directly rather than through the JSON-only `tarsFetch`.
 */
export async function uploadTarsSqliteDatabase(
  tarsId: string,
  input: TarsSqliteUploadInput,
  file: TarsUploadedFile,
  baseUrl?: string,
): Promise<TarsDatasetDatabase | null> {
  const path = '/api/dataset_sql/upload_sqlite';
  const form = new FormData();
  form.append('user_id', tarsId);
  form.append('name', input.name);
  form.append('description', input.description ?? '');
  form.append('allowed_km_ids', JSON.stringify(input.allowedKmIds ?? []));
  form.append(
    'sqlite_file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype ?? 'application/octet-stream' }),
    file.filename,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${getTarsBaseUrl(baseUrl)}${path}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      let serverMessage: string | undefined;
      try {
        const body = (await response.json()) as { message?: unknown; error?: unknown };
        const detail = body?.error ?? body?.message;
        if (typeof detail === 'string') {
          serverMessage = detail;
        }
      } catch {
        /* non-JSON error body */
      }
      throw new TarsRequestError(response.status, path, serverMessage);
    }
    const body = (await response.json()) as DatasetMutationResponse;
    return body?.dataset != null ? toSafeDatabase(body.dataset) : null;
  } finally {
    clearTimeout(timeout);
  }
}
