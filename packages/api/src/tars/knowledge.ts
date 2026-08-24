import { tarsFetch, getTarsBaseUrl } from './client';

/**
 * A pwc_tars knowledge base. Base fields mirror `KnowledgeBase.to_dict()`; the
 * `*_count` stats are only present on the `prepare_data` listing.
 */
export interface TarsKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  data_source_type?: string | null;
  embedding_model?: string | null;
  rerank_model?: string | null;
  llm_model?: string | null;
  max_retrieve_count?: number | null;
  status?: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  document_count?: number;
  website_count?: number;
  api_count?: number;
  fs_count?: number;
  total_chunk_count?: number;
  total_token_count?: number;
  has_sql_database?: boolean;
  /** Ids allowed to use the KB. Empty means "everyone", matching pwc_tars. */
  allowed_user_ids?: string[];
  allowed_user_group_ids?: string[];
}

/** A selectable model option for the knowledge-base upload form. */
export interface TarsModelOption {
  id: string;
  name: string;
}

export interface TarsKnowledgeBaseInput {
  name: string;
  description?: string;
  data_source_type?: string;
  embedding_model?: string;
  collection_binding_name?: string;
}

export interface TarsKnowledgeBaseUpdate {
  name?: string;
  description?: string;
  domain_ids?: string;
  new_max_retrieve_count?: number;
  /**
   * pwc_tars only touches these when the key is present, so an omitted list
   * leaves the stored permissions alone rather than clearing them.
   */
  allowed_user_ids?: string[];
  allowed_user_group_ids?: string[];
}

/** A file forwarded from the LibreChat upload route to pwc_tars. */
export interface TarsUploadFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface TarsKnowledgeBaseFileInput {
  knowledgeName: string;
  description?: string;
  tags?: string;
  llmModel: string;
  embeddingModel?: string;
  rerankModel?: string;
  maxRetrieveCount?: number;
  allowedUserIds?: string[];
  allowedUserGroupIds?: string[];
  /** Optional seed file. pwc_tars creates the KB + RAG config even without it. */
  file?: TarsUploadFile;
}

/** A pwc_tars document inside a knowledge base (`Document.to_dict()`). */
export interface TarsDocument {
  id: string;
  filename: string;
  knowledge_base_ids?: string | null;
  /** Set when the document came in through a document group. */
  dataset_file_system_id?: string | null;
  size?: number | null;
  extension?: string | null;
  mime_type?: string | null;
  status: number;
  hash?: string | null;
  word_count?: number | null;
  tokens?: number | null;
  tags?: string | null;
  file_path?: string | null;
  chunk_size?: number | null;
  overlap_size?: number | null;
  file_source?: string | null;
  llm_model?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A pwc_tars chunk of a document (`ChunkFile.to_dict()`). */
export interface TarsChunk {
  id: string;
  document_id: string;
  filename?: string | null;
  position: number;
  content: string;
  word_count?: number | null;
  tokens?: number | null;
  hit_count?: number | null;
  enabled?: boolean;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Per-file chunk override keyed by filename, matching pwc_tars `file_settings`. */
export interface TarsFileSetting {
  chunkSize?: number;
  overlap?: number;
}

export interface TarsDocumentUploadInput {
  knowledgeBaseId: string;
  files: TarsUploadFile[];
  chunkSize?: number;
  overlap?: number;
  processImages?: boolean;
  /** Optional per-file overrides keyed by filename. */
  fileSettings?: Record<string, TarsFileSetting>;
  tags?: string;
}

export interface TarsDocumentRenameInput {
  knowledgeBaseId: string;
  documentId: string;
  newFilename: string;
}

export interface TarsDocumentDeleteInput {
  knowledgeBaseId: string;
  documentId: string;
}

export interface TarsDocumentReprocessInput {
  knowledgeBaseId: string;
  documentId: string;
  chunkSize?: number;
  overlap?: number;
}

interface KnowledgeBasesResponse {
  knowledge_bases?: TarsKnowledgeBase[];
}

/** A person who may be granted access to a knowledge base. */
export interface TarsKnowledgeBaseUser {
  id: string;
  username: string | null;
  display_name: string | null;
}

/** A group that may be granted access to a knowledge base. */
export interface TarsKnowledgeBaseGroup {
  id: string;
  name: string;
}

/**
 * Everything the knowledge-base listing needs in one call: the bases the caller
 * may see, plus the people and groups the permission pickers offer.
 */
export interface TarsKnowledgeBaseOverview {
  knowledge_bases: TarsKnowledgeBase[];
  users: TarsKnowledgeBaseUser[];
  user_groups: TarsKnowledgeBaseGroup[];
}

/** One selectable model on the per-knowledge-base binding form. */
export interface TarsBindableModel {
  id: string;
  name: string;
  note?: string;
}

/**
 * The models a knowledge base may be bound to, with what it currently uses.
 * pwc_tars drops LLMs whose API key is invalid or that its health checker
 * cannot reach, so this list is narrower than the raw `/api/model/*` ones.
 */
export interface TarsKnowledgeBaseModelBindings {
  embedding: { selected_id: string | null; options: TarsBindableModel[] };
  rerank: { selected_id: string | null; options: TarsBindableModel[] };
  llm: { selected_id: string | null; options: TarsBindableModel[] };
}

export interface TarsKnowledgeBaseModelUpdate {
  rerank_model_id?: string;
  llm_model_id?: string;
}

interface PrepareDataResponse {
  knowledge_bases?: TarsKnowledgeBase[];
  users?: TarsKnowledgeBaseUser[];
  user_groups?: TarsKnowledgeBaseGroup[];
}

interface RawModelName {
  model_name: string;
}

interface RawModelOption {
  id?: string;
  display_name?: string;
}

/**
 * The knowledge bases a pwc_tars user may access, with document/chunk/token
 * stats (`GET /api/knowledge_base/prepare_data`). Admins (role 1) get all KBs.
 */
export async function fetchTarsKnowledgeBaseOverview(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsKnowledgeBaseOverview> {
  if (!tarsId) {
    return { knowledge_bases: [], users: [], user_groups: [] };
  }
  const data = await tarsFetch<PrepareDataResponse>('/api/knowledge_base/prepare_data', {
    query: { user_id: tarsId },
    baseUrl,
  });
  return {
    knowledge_bases: data?.knowledge_bases ?? [],
    users: data?.users ?? [],
    user_groups: data?.user_groups ?? [],
  };
}

/** Just the bases, for callers that do not need the permission pickers. */
export async function fetchTarsKnowledgeBases(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsKnowledgeBase[]> {
  const overview = await fetchTarsKnowledgeBaseOverview(tarsId, baseUrl);
  return overview.knowledge_bases;
}

/**
 * The models this knowledge base may be bound to
 * (`GET /api/knowledge_detail/get_models_by_knowledge`).
 */
export async function fetchTarsKnowledgeBaseModelBindings(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TarsKnowledgeBaseModelBindings> {
  const data = await tarsFetch<Partial<TarsKnowledgeBaseModelBindings>>(
    '/api/knowledge_detail/get_models_by_knowledge',
    { query: { user_id: tarsId, knowledge_base_id: knowledgeBaseId }, baseUrl },
  );
  const empty = { selected_id: null, options: [] };
  return {
    embedding: data?.embedding ?? empty,
    rerank: data?.rerank ?? empty,
    llm: data?.llm ?? empty,
  };
}

/**
 * Rebinds a knowledge base's rerank and/or LLM model
 * (`POST /api/knowledge_detail/update_knowledge_base_model`). The embedding
 * model is deliberately not settable: the stored vectors were built with it.
 */
export async function updateTarsKnowledgeBaseModel(
  tarsId: string,
  knowledgeBaseId: string,
  update: TarsKnowledgeBaseModelUpdate,
  baseUrl?: string,
): Promise<TarsKnowledgeBase> {
  return tarsFetch<TarsKnowledgeBase>('/api/knowledge_detail/update_knowledge_base_model', {
    method: 'POST',
    body: { user_id: tarsId, knowledge_base_id: knowledgeBaseId, ...update },
    baseUrl,
  });
}

export async function createTarsKnowledgeBase(
  tarsId: string,
  input: TarsKnowledgeBaseInput,
  baseUrl?: string,
): Promise<TarsKnowledgeBase> {
  const data = await tarsFetch<{ knowledge_base: TarsKnowledgeBase }>(
    '/api/knowledge_base/create_knowledge_base',
    { method: 'POST', body: { ...input, created_by: tarsId }, baseUrl },
  );
  return data.knowledge_base;
}

export async function updateTarsKnowledgeBase(
  tarsId: string,
  knowledgeBaseId: string,
  update: TarsKnowledgeBaseUpdate,
  baseUrl?: string,
): Promise<TarsKnowledgeBase> {
  const data = await tarsFetch<{ knowledge_base: TarsKnowledgeBase }>(
    `/api/knowledge_base/update_knowledge_base/${encodeURIComponent(knowledgeBaseId)}`,
    { method: 'PUT', body: { ...update, updated_by: tarsId }, baseUrl },
  );
  return data.knowledge_base;
}

/**
 * Deletes a knowledge base (pwc_tars cascades Milvus / chunks / documents).
 *
 * The deletion itself needs no operator, but pwc_tars records one audit entry
 * from `operator_id`; a DELETE carries no body, so it travels as a query param.
 */
export async function deleteTarsKnowledgeBase(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(
    `/api/knowledge_base/delete_knowledge_base/${encodeURIComponent(knowledgeBaseId)}`,
    {
      method: 'DELETE',
      query: { operator_id: tarsId },
      baseUrl,
    },
  );
}

/** LLM / embedding / rerank model options for the upload form. */
export async function fetchTarsModelOptions(baseUrl?: string): Promise<{
  llm: TarsModelOption[];
  embedding: TarsModelOption[];
  rerank: TarsModelOption[];
}> {
  const [llmRaw, embeddingRaw, rerankRaw] = await Promise.all([
    tarsFetch<RawModelName[]>('/api/model/get_model_list', { baseUrl }),
    tarsFetch<RawModelOption[]>('/api/model/embedding_model_list', { baseUrl }),
    tarsFetch<RawModelOption[]>('/api/model/rerank_model_list', { baseUrl }),
  ]);
  return {
    llm: (llmRaw ?? []).map((model) => ({ id: model.model_name, name: model.model_name })),
    embedding: (embeddingRaw ?? []).map((model) => ({
      id: model.id ?? '',
      name: model.display_name ?? model.id ?? '',
    })),
    rerank: (rerankRaw ?? []).map((model) => ({
      id: model.id ?? '',
      name: model.display_name ?? model.id ?? '',
    })),
  };
}

/**
 * Forwards a file to pwc_tars to create a knowledge base with content
 * (`POST /api/knowledge_base/create_knowledge_base_with_file`). pwc_tars owns
 * chunking, embedding and Milvus indexing — LibreChat only proxies the upload.
 */
export async function createTarsKnowledgeBaseWithFile(
  tarsId: string,
  input: TarsKnowledgeBaseFileInput,
  baseUrl?: string,
): Promise<KnowledgeBasesResponse & Record<string, unknown>> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/knowledge_base/create_knowledge_base_with_file`;
  const form = new FormData();
  form.append('user_id', tarsId);
  form.append('knowledge_name', input.knowledgeName);
  form.append('description', input.description ?? `Knowledge base for ${input.knowledgeName}`);
  form.append('llm_model', input.llmModel);
  if (input.tags) {
    form.append('tags', input.tags);
  }
  if (input.embeddingModel) {
    form.append('embedding_model', input.embeddingModel);
  }
  if (input.rerankModel) {
    form.append('rerank_model', input.rerankModel);
  }
  if (input.maxRetrieveCount != null) {
    form.append('max_retrieve_count', String(input.maxRetrieveCount));
  }
  /** pwc_tars parses these two with `json.loads`, so they go over as JSON text. */
  form.append('allowed_user_ids', JSON.stringify(input.allowedUserIds ?? []));
  form.append('allowed_user_group_ids', JSON.stringify(input.allowedUserGroupIds ?? []));
  if (input.file) {
    const blob = new Blob([new Uint8Array(input.file.buffer)], { type: input.file.mimetype });
    form.append('file', blob, input.file.filename);
  }

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`pwc_tars knowledge-base upload returned status ${response.status}`);
  }
  return (await response.json()) as KnowledgeBasesResponse & Record<string, unknown>;
}

interface DocumentsResponse {
  documents?: TarsDocument[];
  totalDocuments?: number;
}

interface ChunksResponse {
  chunks?: TarsChunk[];
  totalChunks?: number;
}

/** Documents inside a knowledge base (`GET /api/knowledge_detail/get_files_by_id`). */
export async function fetchTarsKnowledgeBaseDocuments(
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TarsDocument[]> {
  if (!knowledgeBaseId) {
    return [];
  }
  const data = await tarsFetch<DocumentsResponse>('/api/knowledge_detail/get_files_by_id', {
    query: { knowledge_base_id: knowledgeBaseId },
    baseUrl,
  });
  return data?.documents ?? [];
}

/**
 * Uploads one or more documents into an existing knowledge base
 * (`POST /api/knowledge_detail/upload_multiple_file`). pwc_tars chunks, embeds
 * and indexes in a background thread — LibreChat only proxies the files.
 */
export async function uploadTarsKnowledgeBaseDocuments(
  tarsId: string,
  input: TarsDocumentUploadInput,
  baseUrl?: string,
): Promise<Record<string, unknown>> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/knowledge_detail/upload_multiple_file`;
  const form = new FormData();
  form.append('user_id', tarsId);
  form.append('knowledge_base_id', input.knowledgeBaseId);
  form.append('chunk_size', String(input.chunkSize ?? 300));
  form.append('overlap', String(input.overlap ?? 50));
  form.append('process_images', String(input.processImages ?? true));
  if (input.tags) {
    form.append('tags', input.tags);
  }
  if (input.fileSettings && Object.keys(input.fileSettings).length > 0) {
    form.append('file_settings', JSON.stringify(input.fileSettings));
  }
  for (const file of input.files) {
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    form.append('files', blob, file.filename);
  }

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`pwc_tars document upload returned status ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Renames a document (`POST /api/knowledge_detail/rename_file`). */
export async function renameTarsKnowledgeBaseDocument(
  tarsId: string,
  input: TarsDocumentRenameInput,
  baseUrl?: string,
): Promise<TarsDocument> {
  const data = await tarsFetch<{ document: TarsDocument }>('/api/knowledge_detail/rename_file', {
    method: 'POST',
    body: {
      user_id: tarsId,
      knowledge_base_id: input.knowledgeBaseId,
      document_id: input.documentId,
      new_filename: input.newFilename,
    },
    baseUrl,
  });
  return data.document;
}

/** Deletes a document and its chunks/vectors (`POST /api/knowledge_detail/delete_file`). */
export async function deleteTarsKnowledgeBaseDocument(
  tarsId: string,
  input: TarsDocumentDeleteInput,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/knowledge_detail/delete_file', {
    method: 'POST',
    body: {
      user_id: tarsId,
      document_id: input.documentId,
      knowledge_base_id: input.knowledgeBaseId,
    },
    baseUrl,
  });
}

/**
 * Re-chunks and re-embeds an existing document from its stored file
 * (`POST /api/knowledge_detail/reupload_files_to_filesystem`).
 */
export async function reprocessTarsKnowledgeBaseDocument(
  tarsId: string,
  input: TarsDocumentReprocessInput,
  baseUrl?: string,
): Promise<Record<string, unknown>> {
  return tarsFetch<Record<string, unknown>>('/api/knowledge_detail/reupload_files_to_filesystem', {
    method: 'POST',
    body: {
      user_id: tarsId,
      knowledge_base_id: input.knowledgeBaseId,
      document_id: input.documentId,
      chunk_size: input.chunkSize ?? 1000,
      overlap: input.overlap ?? 200,
    },
    baseUrl,
  });
}

/** Chunks of a document (`GET /api/knowledge_detail/get_chunks`). */
export async function fetchTarsDocumentChunks(
  documentId: string,
  baseUrl?: string,
): Promise<TarsChunk[]> {
  if (!documentId) {
    return [];
  }
  const data = await tarsFetch<ChunksResponse>('/api/knowledge_detail/get_chunks', {
    query: { document_id: documentId },
    baseUrl,
  });
  return data?.chunks ?? [];
}
