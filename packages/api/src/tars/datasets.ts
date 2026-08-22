import type { TarsDocument, TarsKnowledgeBase } from './knowledge';
import { tarsFetch } from './client';

/**
 * Crawling, downloading and embedding all happen inside the pwc_tars request,
 * which budgets 250s for the summary step alone. The default client timeout
 * would abandon a job that is still running and about to succeed.
 */
const INGEST_TIMEOUT_MS = 300000;

/** Listing a database's tables opens a real connection, which can be slow. */
const CONNECT_TIMEOUT_MS = 60000;

/** A website dataset bound to a knowledge base (`DatasetWebsite.to_json()`). */
export interface TarsDatasetWebsite {
  id: string;
  name: string | null;
  description: string | null;
  url: string | null;
  status: number | null;
  size: number | null;
  word_count: number | null;
  tokens: number | null;
  chunk_size: number | null;
  tags: string | null;
  website_metatype: string | null;
  /** Injected by `prepare_data` from the knowledge-base relation. */
  llm_model?: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/**
 * A database connection, with every credential removed.
 *
 * pwc_tars' `DatasetSQL.to_json()` serialises the whole row — `password` and
 * `connection_string` included — so the fields are listed explicitly here
 * rather than spread, making it impossible to widen the shape by accident.
 */
export interface TarsDatasetDatabase {
  id: string;
  name: string;
  description: string | null;
  db_type: string | null;
  host: string | null;
  port: number | null;
  database_name: string | null;
  schema: string | null;
  service_name: string | null;
  sid: string | null;
  status: number | null;
  allowed_km_ids: string[];
  /** Both injected by `prepare_data` from the knowledge-base relation. */
  llm_model?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A document-group link between a knowledge base and a file server. */
export interface TarsDatasetFileSystemLink {
  id: string;
  knowledge_base_id: string;
  dataset_file_system_id: string;
  name: string | null;
  status: number | null;
  llm_model: string | null;
  schedule_id: string | null;
  is_sync_all: boolean | null;
  is_upload_only: boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A file server that document groups can be imported from, without its password. */
export interface TarsFileSystemSource {
  id: string;
  name: string;
  description: string | null;
  mount_type: string | null;
  host: string | null;
  port: number | null;
  path: string | null;
  host_name: string | null;
  status: number | null;
  allowed_km_ids: string[];
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** System-wide ceilings the upload forms must respect (`sys_config`). */
export interface TarsDatasetLimits {
  max_upload_counts: number;
  max_chunk_size: number;
  max_overlap: number;
}

export interface TarsDatasetStats {
  document_count: number;
  total_word_count: number;
  total_token_count: number;
  /** API datasets are listed nowhere else, so the count keeps them visible. */
  api_count: number;
}

/** Everything the knowledge-base detail page needs, in one call. */
export interface TarsKnowledgeBaseDatasets {
  knowledge_base: TarsKnowledgeBase | null;
  documents: TarsDocument[];
  websites: TarsDatasetWebsite[];
  databases: TarsDatasetDatabase[];
  file_systems: TarsDatasetFileSystemLink[];
  /** Connections this knowledge base is allowed to bind, already-bound ones included. */
  available_databases: TarsDatasetDatabase[];
  limits: TarsDatasetLimits;
  stats: TarsDatasetStats;
}

export interface TarsRawDatabase extends TarsDatasetDatabase {
  password?: string;
  connection_string?: string;
  username?: string;
  extra_params?: string;
}

/**
 * The stored row as pwc_tars serialises it. `to_dict()` includes the file
 * server's account and password, so nothing may hand this to a client.
 */
export interface TarsRawFileSystem extends TarsFileSystemSource {
  password?: string;
  account?: string;
}

interface PrepareDatasetsResponse {
  knowledge_base?: TarsKnowledgeBase;
  documents?: TarsDocument[];
  dataset_websites?: TarsDatasetWebsite[];
  dataset_apis?: unknown[];
  dataset_sqls?: TarsRawDatabase[];
  dataset_file_systems?: TarsDatasetFileSystemLink[];
  all_dataset_sqls?: TarsRawDatabase[];
  document_count?: number;
  total_word_count?: number;
  total_token_count?: number;
  max_upload_counts?: number;
  max_chunk_size?: number;
  max_overlap?: number;
}

/**
 * Copies only the fields the UI needs. pwc_tars sends the stored password and
 * connection string on every database row; neither belongs in a browser.
 */
export const toSafeDatabase = (row: TarsRawDatabase): TarsDatasetDatabase => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  db_type: row.db_type ?? null,
  host: row.host ?? null,
  port: row.port ?? null,
  database_name: row.database_name ?? null,
  schema: row.schema ?? null,
  service_name: row.service_name ?? null,
  sid: row.sid ?? null,
  status: row.status ?? null,
  allowed_km_ids: row.allowed_km_ids ?? [],
  llm_model: row.llm_model ?? null,
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? null,
});

/** Same reasoning as `toSafeDatabase`: the file-server password never leaves here. */
export const toSafeFileSystem = (row: TarsRawFileSystem): TarsFileSystemSource => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  mount_type: row.mount_type ?? null,
  host: row.host ?? null,
  port: row.port ?? null,
  path: row.path ?? null,
  host_name: row.host_name ?? null,
  status: row.status ?? null,
  allowed_km_ids: row.allowed_km_ids ?? [],
  created_by: row.created_by ?? null,
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? null,
});

/**
 * The five dataset kinds a knowledge base holds
 * (`GET /api/knowledge_detail/prepare_data`).
 */
export async function fetchTarsKnowledgeBaseDatasets(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TarsKnowledgeBaseDatasets> {
  const data = await tarsFetch<PrepareDatasetsResponse>('/api/knowledge_detail/prepare_data', {
    query: { user_id: tarsId, knowledge_base_ids: knowledgeBaseId },
    baseUrl,
  });

  return {
    knowledge_base: data?.knowledge_base ?? null,
    documents: data?.documents ?? [],
    websites: data?.dataset_websites ?? [],
    databases: (data?.dataset_sqls ?? []).map(toSafeDatabase),
    file_systems: data?.dataset_file_systems ?? [],
    available_databases: (data?.all_dataset_sqls ?? []).map(toSafeDatabase),
    limits: {
      max_upload_counts: data?.max_upload_counts ?? 5,
      max_chunk_size: data?.max_chunk_size ?? 30000,
      max_overlap: data?.max_overlap ?? 300,
    },
    stats: {
      document_count: data?.document_count ?? 0,
      total_word_count: data?.total_word_count ?? 0,
      total_token_count: data?.total_token_count ?? 0,
      api_count: (data?.dataset_apis ?? []).length,
    },
  };
}

export interface TarsWebsiteImportInput {
  knowledgeBaseId: string;
  name: string;
  url: string;
  description?: string;
  /** pwc_tars treats 1 as enabled, 0 as imported-but-inactive. */
  enabled?: boolean;
  chunkSize?: number;
}

/**
 * Crawls a site and imports it as a dataset
 * (`POST /api/knowledge_detail/import_website_dataset`).
 */
export async function importTarsWebsiteDataset(
  tarsId: string,
  input: TarsWebsiteImportInput,
  baseUrl?: string,
): Promise<TarsDatasetWebsite | null> {
  const data = await tarsFetch<{ dataset_websites?: TarsDatasetWebsite }>(
    '/api/knowledge_detail/import_website_dataset',
    {
      method: 'POST',
      timeoutMs: INGEST_TIMEOUT_MS,
      baseUrl,
      body: {
        user_id: tarsId,
        knowledge_base_id: input.knowledgeBaseId,
        name: input.name,
        url: input.url,
        description: input.description ?? '',
        status: input.enabled === false ? 0 : 1,
        ...(input.chunkSize != null ? { chunk_size: input.chunkSize } : {}),
      },
    },
  );
  return data?.dataset_websites ?? null;
}

/** Renames or re-describes a website dataset. The URL is not editable. */
export async function updateTarsWebsiteDataset(
  tarsId: string,
  websiteId: string,
  update: { name: string; description?: string },
  baseUrl?: string,
): Promise<TarsDatasetWebsite | null> {
  const data = await tarsFetch<{ dataset_websites?: TarsDatasetWebsite }>(
    '/api/knowledge_detail/update_dataset_website',
    {
      method: 'POST',
      baseUrl,
      body: {
        user_id: tarsId,
        dataset_website_id: websiteId,
        name: update.name,
        description: update.description ?? '',
      },
    },
  );
  return data?.dataset_websites ?? null;
}

/** Deletes a website dataset along with its chunks and vectors. */
export async function deleteTarsWebsiteDataset(
  tarsId: string,
  knowledgeBaseId: string,
  websiteId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/delete_dataset_website', {
    method: 'POST',
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_website_id: websiteId,
    },
  });
}

/** The tables and views a database connection exposes. */
export interface TarsDatabaseTables {
  tables: string[];
  views: string[];
}

/**
 * Lists a connection's tables (`POST /api/dataset_sql/test_connection`).
 *
 * That endpoint wants the credentials in its body, so the connection is read
 * here — where pwc_tars still sends the password — rather than asking the
 * browser to hold one and hand it back.
 */
export async function fetchTarsDatabaseTables(
  tarsId: string,
  knowledgeBaseId: string,
  datasetSqlId: string,
  baseUrl?: string,
): Promise<TarsDatabaseTables> {
  const prepared = await tarsFetch<PrepareDatasetsResponse>('/api/knowledge_detail/prepare_data', {
    query: { user_id: tarsId, knowledge_base_ids: knowledgeBaseId },
    baseUrl,
  });
  const connection = (prepared?.all_dataset_sqls ?? []).find((row) => row.id === datasetSqlId);
  if (connection == null) {
    throw new Error(`pwc_tars has no database connection ${datasetSqlId}`);
  }

  const data = await tarsFetch<{ data?: Partial<TarsDatabaseTables> }>(
    '/api/dataset_sql/test_connection',
    {
      method: 'POST',
      timeoutMs: CONNECT_TIMEOUT_MS,
      baseUrl,
      body: {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        database_name: connection.database_name,
        db_type: connection.db_type,
        service_name: connection.service_name,
        sid: connection.sid,
      },
    },
  );
  return { tables: data?.data?.tables ?? [], views: data?.data?.views ?? [] };
}

/**
 * Binds a database's chosen tables to a knowledge base
 * (`POST /api/knowledge_detail/bind_db_to_km`). Re-binding with a different
 * table list is how pwc_tars adjusts an existing binding.
 */
export async function bindTarsDatabase(
  tarsId: string,
  knowledgeBaseId: string,
  datasetSqlId: string,
  tables: string[],
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/bind_db_to_km', {
    method: 'POST',
    timeoutMs: INGEST_TIMEOUT_MS,
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_sql_id: datasetSqlId,
      tables,
    },
  });
}

/** Removes the binding. The connection itself is left in place. */
export async function unbindTarsDatabase(
  tarsId: string,
  knowledgeBaseId: string,
  datasetSqlId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/disconnect_sql_km', {
    method: 'POST',
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_sql_id: datasetSqlId,
    },
  });
}

/** The tables currently bound, for pre-ticking the table picker. */
export async function fetchTarsBoundTables(
  tarsId: string,
  knowledgeBaseId: string,
  datasetSqlId: string,
  baseUrl?: string,
): Promise<string[]> {
  const data = await tarsFetch<{ tables?: string[] }>('/api/knowledge_detail/get_bind_tables', {
    query: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_sql_id: datasetSqlId,
    },
    baseUrl,
  });
  return data?.tables ?? [];
}

/** The schema description the text-to-SQL prompt is built from. */
export interface TarsDatabasePrompt {
  id: string;
  dataset_sql_id: string;
  knowledge_base_id: string;
  tables: string | null;
  llm_table_info: string | null;
  llm_model: string | null;
}

export async function fetchTarsDatabasePrompt(
  knowledgeBaseId: string,
  datasetSqlId: string,
  baseUrl?: string,
): Promise<TarsDatabasePrompt> {
  return tarsFetch<TarsDatabasePrompt>('/api/knowledge_detail/get_km_to_sql_prompt', {
    query: { knowledge_base_id: knowledgeBaseId, dataset_sql_id: datasetSqlId },
    baseUrl,
  });
}

/** Keyed by the binding's id, which `fetchTarsDatabasePrompt` returns. */
export async function updateTarsDatabasePrompt(
  tarsId: string,
  bindingId: string,
  tableInfo: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/update_km_to_sql_prompt', {
    method: 'POST',
    baseUrl,
    body: { id: bindingId, user_id: tarsId, new_table_info: tableInfo },
  });
}

/**
 * The file servers this knowledge base may import a document group from
 * (`GET /api/dataset_file_system/get_dataset_file_systems`). pwc_tars filters
 * by `allowed_km_ids` unless the caller is an admin.
 */
export async function fetchTarsFileSystemSources(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TarsFileSystemSource[]> {
  const data = await tarsFetch<{ dataset_file_systems?: TarsRawFileSystem[] }>(
    '/api/dataset_file_system/get_dataset_file_systems',
    { query: { user_id: tarsId, knowledge_base_ids: knowledgeBaseId }, baseUrl },
  );
  return (data?.dataset_file_systems ?? []).map(toSafeFileSystem);
}

/**
 * Lists what a file server currently holds
 * (`POST /api/dataset_file_system/test_connection`).
 *
 * Like the database variant, the credentials are looked up here so they never
 * reach the browser. pwc_tars only walks the tree when `is_sync_all` is set.
 */
export async function fetchTarsFileSystemFiles(
  tarsId: string,
  knowledgeBaseId: string,
  fileSystemId: string,
  baseUrl?: string,
): Promise<string[]> {
  const sources = await tarsFetch<{ dataset_file_systems?: TarsRawFileSystem[] }>(
    '/api/dataset_file_system/get_dataset_file_systems',
    { query: { user_id: tarsId, knowledge_base_ids: knowledgeBaseId }, baseUrl },
  );
  const source = (sources?.dataset_file_systems ?? []).find((row) => row.id === fileSystemId);
  if (source == null) {
    throw new Error(`pwc_tars has no file system ${fileSystemId}`);
  }

  const data = await tarsFetch<{ files?: string[] }>('/api/dataset_file_system/test_connection', {
    method: 'POST',
    timeoutMs: CONNECT_TIMEOUT_MS,
    baseUrl,
    body: {
      protocol: source.mount_type,
      host: source.host,
      port: source.port,
      path: source.path,
      account: source.account,
      password: source.password,
      hostname: source.host_name,
      is_sync_all: true,
    },
  });
  return data?.files ?? [];
}

/** Per-file chunk overrides, keyed by the path the file server reported. */
export interface TarsFileSystemImportInput {
  knowledgeBaseId: string;
  fileSystemId: string;
  name: string;
  /** Import everything under the path rather than the listed selection. */
  syncAll?: boolean;
  /** Store the files without chunking or embedding them. */
  uploadOnly?: boolean;
  fileSettings?: Record<string, { chunkSize?: number; overlap?: number }>;
  tags?: string;
}

/** Imports a document group (`POST /api/knowledge_detail/upload_file_server_files`). */
export async function importTarsFileSystemDataset(
  tarsId: string,
  input: TarsFileSystemImportInput,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/upload_file_server_files', {
    method: 'POST',
    timeoutMs: INGEST_TIMEOUT_MS,
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: input.knowledgeBaseId,
      dataset_file_system_id: input.fileSystemId,
      name: input.name,
      is_sync_all: input.syncAll === true,
      is_upload_only: input.uploadOnly === true,
      file_settings: input.fileSettings ?? {},
      tags: input.tags ?? '',
    },
  });
}

/**
 * Pulls anything new or newer from the file server
 * (`POST /api/knowledge_detail/refresh_file_server_files`). pwc_tars reads the
 * connection itself, so only the ids travel.
 */
export async function refreshTarsFileSystemDataset(
  tarsId: string,
  knowledgeBaseId: string,
  fileSystemId: string,
  chunk: { chunkSize?: number; overlap?: number } = {},
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/refresh_file_server_files', {
    method: 'POST',
    timeoutMs: INGEST_TIMEOUT_MS,
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_file_system_id: fileSystemId,
      new_file_chunk_size: chunk.chunkSize ?? 1000,
      new_file_overlap_size: chunk.overlap ?? 100,
    },
  });
}

/** Reprocesses every unfinished document in a group (`reupload_batch_file`). */
export async function reprocessTarsFileSystemDataset(
  tarsId: string,
  knowledgeBaseId: string,
  fileSystemId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/reupload_batch_file', {
    method: 'POST',
    timeoutMs: INGEST_TIMEOUT_MS,
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_file_system_id: fileSystemId,
    },
  });
}

/** Unlinks a document group, deleting the documents it brought in. */
export async function unlinkTarsFileSystemDataset(
  tarsId: string,
  knowledgeBaseId: string,
  fileSystemId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/dataset_file_system/unlink_file_system', {
    method: 'POST',
    timeoutMs: INGEST_TIMEOUT_MS,
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      dataset_file_system_id: fileSystemId,
    },
  });
}

/**
 * Deletes several datasets at once
 * (`POST /api/knowledge_detail/batch_delete_datasets`).
 *
 * pwc_tars answers 202 and does the work on a background thread, so a caller
 * must refetch rather than treat the response as "deleted". Document groups
 * have no id list here — they are unlinked one group at a time instead.
 */
export async function batchDeleteTarsDatasets(
  tarsId: string,
  knowledgeBaseId: string,
  ids: { documentIds?: string[]; websiteIds?: string[]; databaseIds?: string[] },
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/batch_delete_datasets', {
    method: 'POST',
    baseUrl,
    body: {
      user_id: tarsId,
      knowledge_base_id: knowledgeBaseId,
      document_ids: ids.documentIds ?? [],
      dataset_website_ids: ids.websiteIds ?? [],
      dataset_sql_ids: ids.databaseIds ?? [],
      dataset_api_ids: [],
    },
  });
}

/**
 * One crawled slice of a website (`ChunkWebsite.to_json()`).
 *
 * The same shape as a document chunk apart from what it belongs to — pwc_tars
 * keeps the two in separate tables, so the identifying pair differs.
 */
export interface TarsWebsiteChunk {
  id: string;
  website_id: string;
  url: string | null;
  position: number;
  content: string;
  word_count: number | null;
  tokens: number | null;
  keywords: string | null;
  hit_count: number | null;
  enabled: boolean | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TarsWebsiteChunkPage {
  website: TarsDatasetWebsite | null;
  chunks: TarsWebsiteChunk[];
  totalChunks: number;
}

/**
 * Every chunk of one website dataset
 * (`GET /api/knowledge_detail/get_website_chunk`).
 *
 * Unpaged, like the document equivalent: pwc_tars returns the whole set and
 * the client pages through it.
 */
export async function fetchTarsWebsiteChunks(
  tarsId: string,
  websiteId: string,
  baseUrl?: string,
): Promise<TarsWebsiteChunkPage> {
  const data = await tarsFetch<Partial<TarsWebsiteChunkPage>>(
    '/api/knowledge_detail/get_website_chunk',
    { query: { user_id: tarsId, website_id: websiteId }, baseUrl },
  );
  const chunks = data?.chunks ?? [];
  return {
    website: data?.website ?? null,
    chunks,
    totalChunks: data?.totalChunks ?? chunks.length,
  };
}
