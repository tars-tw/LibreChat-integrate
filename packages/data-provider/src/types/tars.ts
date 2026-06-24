/**
 * A pwc_tars specialized brain ("專用腦") as surfaced to the LibreChat client.
 * Mirrors the backend `TarsDomain` (pwc_tars `SysDomain.to_dict()`):
 * `role_ids` / `knowledge_base_ids` are comma-separated id strings and
 * `domain_functions` is a JSON string of capability toggles.
 */
export type TTarsDomain = {
  id: number;
  name: string;
  description: string | null;
  role_ids: string | null;
  knowledge_base_ids: string | null;
  domain_functions: string | null;
  status: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  url?: string;
};

export type TTarsDomainsResponse = {
  domains: TTarsDomain[];
};

/** A pwc_tars role, for the domain editor's role multi-select. */
export type TTarsRole = {
  id: number;
  name: string;
  domain_ids?: string | null;
};

/** A pwc_tars knowledge base. `*_count` stats are present on the admin listing. */
export type TTarsKnowledgeBase = {
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
};

export type TTarsDomainPrepareData = {
  sys_domains: TTarsDomain[];
  knowledge_bases: TTarsKnowledgeBase[];
  roles: TTarsRole[];
};

/** Create/update payload for a specialized brain. */
export type TTarsDomainInput = {
  name: string;
  description?: string;
  role_ids?: string;
  knowledge_base_ids?: string;
  domain_functions?: string;
  status?: number | boolean;
};

export type TTarsKnowledgeBasesResponse = {
  knowledgeBases: TTarsKnowledgeBase[];
};

export type TTarsModelOption = {
  id: string;
  name: string;
};

export type TTarsModelOptions = {
  llm: TTarsModelOption[];
  embedding: TTarsModelOption[];
  rerank: TTarsModelOption[];
};

export type TTarsKnowledgeBaseInput = {
  name: string;
  description?: string;
  data_source_type?: string;
  embedding_model?: string;
  collection_binding_name?: string;
};

export type TTarsKnowledgeBaseUpdate = {
  name?: string;
  description?: string;
  domain_ids?: string;
  new_max_retrieve_count?: number;
};

/** A document inside a knowledge base (pwc_tars `Document.to_dict()`). */
export type TTarsDocument = {
  id: string;
  filename: string;
  knowledge_base_ids?: string | null;
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
};

export type TTarsDocumentsResponse = {
  documents: TTarsDocument[];
};

/** A chunk of a document (pwc_tars `ChunkFile.to_dict()`). */
export type TTarsChunk = {
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
};

export type TTarsChunksResponse = {
  chunks: TTarsChunk[];
};

/** Per-file chunk override keyed by filename, matching pwc_tars `file_settings`. */
export type TTarsFileSetting = {
  chunkSize?: number;
  overlap?: number;
};

export type TTarsChunkUpdate = {
  content: string;
};

export type TTarsDocumentReprocess = {
  chunkSize?: number;
  overlap?: number;
};

/** Which pwc_tars table a "我的提示" lives in — its visibility tier. */
export type TTarsPromptScope = 'personal' | 'domain' | 'knowledge_base';

/**
 * A pwc_tars "我的提示" as surfaced to the client. Mirrors the backend
 * `TarsPrompt` (pwc_tars `Prompt.to_dict()`). `knowledge_base_name` is present
 * only on knowledge-base prompts; `scope` is tagged by the chat aggregator.
 */
export type TTarsPrompt = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  content: string;
  status: number;
  created_by: string;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  knowledge_base_name?: string | null;
  scope?: TTarsPromptScope;
};

/** A specialized brain's knowledge base, for the create form's scope picker. */
export type TTarsPromptKnowledgeBase = {
  id: string;
  name: string;
};

export type TTarsPromptsResponse = {
  prompts: TTarsPrompt[];
  knowledgeBases: TTarsPromptKnowledgeBase[];
};

/** Create/update payload for a "我的提示". */
export type TTarsPromptInput = {
  name: string;
  content: string;
  category: string;
  description?: string;
  status?: number;
  domain_id?: string | number;
  knowledge_base_id?: string;
};
