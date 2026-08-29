import type { TarsUploadFile } from '~/tars/knowledge';
import { tarsFetch, getTarsBaseUrl, TarsRequestError } from '~/tars/client';
import { resolveLangflowModelName } from '~/tars/langflow/client';

/** csv/xlsx/xls rows are queried via the data/table-task tools, not prompt-injected. */
const STRUCTURED_EXTENSIONS = new Set(['csv', 'xlsx', 'xls']);

/** One `memory_document` row as pwc_tars serializes it (`MemoryDocument.to_dict()`). */
export interface TarsMemoryDocument {
  id: string;
  conversation_id: string;
  filename: string;
  extension: string | null;
  mime_type: string | null;
  size: number | null;
  /** 1 = included in every chat turn of the conversation, 0 = excluded. */
  status: number;
  word_count: number | null;
  tokens: number | null;
  /** The parsed text pwc_tars extracted at upload — what the LLM actually reads. */
  summary: string | null;
  created_by: string | null;
  created_at: string | null;
  /** Derived: whether the data/table-task tools can query this file. */
  structured: boolean;
}

export interface TarsMemoryList {
  documents: TarsMemoryDocument[];
  tokenUsed: number;
  tokenLimit: number;
}

export interface TarsMemoryUploadInput {
  files: TarsUploadFile[];
  /** Existing pwc_tars conversation; blank lets pwc_tars create one and name it. */
  tarsConversationId?: string;
  domainId: string | number;
  /** Chat model of the current conversation; drives pwc_tars's parse-time LLM steps. */
  modelName?: string;
  /** VLM toggle for image files; off = text + OCR only (pwc_tars default: on). */
  processImages?: boolean;
  /** Speech-to-text model for audio files, from `fetchTarsTranscribeModels`. */
  sttModelName?: string;
}

export interface TarsMemoryProcessedFile {
  filename: string;
  size: number;
  extension: string;
  document_id: string;
}

export interface TarsMemoryRejectedFile {
  filename: string;
  tokens: number;
  reason: string;
}

export interface TarsMemoryUploadResult {
  tarsConversationId: string;
  processedFiles: TarsMemoryProcessedFile[];
  rejectedFiles: TarsMemoryRejectedFile[];
  tokenUsed: number;
  tokenLimit: number;
}

export interface TarsMemoryDocumentContent {
  id: string;
  filename: string;
  content: string;
  content_length: number;
  preview_type: string;
  file_available: boolean;
}

interface MemoryEnvelope<T> {
  data?: T;
}

interface RawMemoryDocument extends Omit<TarsMemoryDocument, 'structured' | 'summary'> {
  summary?: string | null;
}

const toMemoryDocument = (row: RawMemoryDocument): TarsMemoryDocument => ({
  ...row,
  summary: row.summary ?? null,
  structured: STRUCTURED_EXTENSIONS.has((row.extension ?? '').toLowerCase()),
});

/**
 * Lists the long-term memory documents of one pwc_tars conversation.
 *
 * pwc_tars's `get_memory_data` takes a `user_id` but does not authorize against
 * it, so ownership is enforced here: rows whose `created_by` is not this user
 * are dropped. Websites are intentionally ignored (files-only integration).
 */
export async function listTarsMemoryDocuments(
  tarsUserId: string,
  tarsConversationId: string,
  baseUrl?: string,
): Promise<TarsMemoryList> {
  const data = await tarsFetch<
    MemoryEnvelope<{
      documents?: RawMemoryDocument[];
      token_used?: number;
      token_limit?: number;
    }>
  >(`/api/conversation/get_memory_data/${encodeURIComponent(tarsConversationId)}`, {
    query: { user_id: tarsUserId },
    baseUrl,
  });
  const documents = (data?.data?.documents ?? [])
    .filter((row) => row.created_by === tarsUserId)
    .map(toMemoryDocument);
  return {
    documents,
    tokenUsed: data?.data?.token_used ?? 0,
    tokenLimit: data?.data?.token_limit ?? 0,
  };
}

/**
 * Uploads files into the pwc_tars long-term memory area
 * (`POST /api/conversation/upload_memory_data`, multipart). With no
 * `tarsConversationId`, pwc_tars creates the conversation and the returned id
 * must be linked to the LibreChat conversation by the caller.
 */
export async function uploadTarsMemoryFiles(
  tarsUserId: string,
  input: TarsMemoryUploadInput,
  baseUrl?: string,
): Promise<TarsMemoryUploadResult> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/conversation/upload_memory_data`;
  const form = new FormData();
  form.append('user_id', tarsUserId);
  form.append('domain_id', String(input.domainId));
  if (input.tarsConversationId) {
    form.append('conversation_id', input.tarsConversationId);
  }
  const modelName = await resolveLangflowModelName(input.modelName, 'tars-memory');
  if (modelName) {
    form.append('model_name', modelName);
  }
  form.append('process_images', String(input.processImages ?? true));
  if (input.sttModelName) {
    form.append('stt_model_name', input.sttModelName);
  }
  for (const file of input.files) {
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    form.append('conversation_files', blob, file.filename);
  }

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    let serverMessage: string | undefined;
    try {
      const errorBody = (await response.json()) as { message?: unknown };
      if (typeof errorBody?.message === 'string') {
        serverMessage = errorBody.message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new TarsRequestError(
      response.status,
      '/api/conversation/upload_memory_data',
      serverMessage,
    );
  }
  const payload = (await response.json()) as MemoryEnvelope<{
    conversation_id?: string;
    processed_files?: TarsMemoryProcessedFile[];
    rejected_files?: TarsMemoryRejectedFile[];
    token_used?: number;
    token_limit?: number;
  }>;
  return {
    tarsConversationId: payload?.data?.conversation_id ?? input.tarsConversationId ?? '',
    processedFiles: payload?.data?.processed_files ?? [],
    rejectedFiles: payload?.data?.rejected_files ?? [],
    tokenUsed: payload?.data?.token_used ?? 0,
    tokenLimit: payload?.data?.token_limit ?? 0,
  };
}

/** Flips a document's include-in-chat flag (`PUT /update_memory_document_status`). */
export async function updateTarsMemoryDocumentStatus(
  tarsUserId: string,
  documentId: string,
  status: 0 | 1,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(
    `/api/conversation/update_memory_document_status/${encodeURIComponent(documentId)}`,
    {
      method: 'PUT',
      query: { user_id: tarsUserId },
      body: { status },
      baseUrl,
    },
  );
}

/** Hard-deletes a memory document and its file on disk (`DELETE /delete_memory_document`). */
export async function deleteTarsMemoryDocument(
  tarsUserId: string,
  documentId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/conversation/delete_memory_document/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    query: { user_id: tarsUserId },
    baseUrl,
  });
}

/** The parsed text and preview metadata of one document (ownership-checked by pwc_tars). */
export async function getTarsMemoryDocumentContent(
  tarsUserId: string,
  documentId: string,
  baseUrl?: string,
): Promise<TarsMemoryDocumentContent> {
  const data = await tarsFetch<MemoryEnvelope<TarsMemoryDocumentContent>>(
    `/api/conversation/get_memory_document_content/${encodeURIComponent(documentId)}`,
    { query: { user_id: tarsUserId }, baseUrl },
  );
  return (
    data?.data ?? {
      id: documentId,
      filename: '',
      content: '',
      content_length: 0,
      preview_type: 'none',
      file_available: false,
    }
  );
}

/**
 * Streams the original uploaded file (ownership-checked by pwc_tars). Returns
 * the upstream `Response` so the route can pipe body and headers through.
 */
export async function downloadTarsMemoryDocument(
  tarsUserId: string,
  documentId: string,
  disposition: 'inline' | 'attachment' = 'attachment',
  baseUrl?: string,
): Promise<Response> {
  const url =
    `${getTarsBaseUrl(baseUrl)}/api/conversation/download_memory_document/` +
    `${encodeURIComponent(documentId)}?user_id=${encodeURIComponent(tarsUserId)}&disposition=${disposition}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new TarsRequestError(response.status, '/api/conversation/download_memory_document');
  }
  return response;
}
