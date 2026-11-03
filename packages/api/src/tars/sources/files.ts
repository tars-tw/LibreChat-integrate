import { posix } from 'path';
import { logger } from '@librechat/data-schemas';
import type { TarsDocument } from '~/tars/knowledge';
import { fetchTarsKnowledgeBaseDocuments } from '~/tars/knowledge';
import { tarsSourceFileUrl } from './link';

/** Where pwc_tars keeps every knowledge-base original, one folder per knowledge base. */
const UPLOADS_ROOT = 'apps/static/uploads';
/**
 * A search may run several times in one answer and the link is opened soon
 * after; a short reuse spares pwc_tars a listing per call without letting a
 * renamed or deleted file linger.
 */
const DOCUMENTS_TTL_MS = 60_000;

export type ListTarsDocuments = (knowledgeBaseId: string) => Promise<TarsDocument[]>;

const documentsCache = new Map<string, { at: number; documents: Promise<TarsDocument[]> }>();

/** Drops the cached document listings, so the next lookup re-reads pwc_tars. */
export function invalidateTarsSourceDocumentsCache(): void {
  documentsCache.clear();
}

/** One knowledge base's documents, reused for a minute; a failed read is not kept. */
export function listTarsSourceDocuments(
  knowledgeBaseId: string,
  list: ListTarsDocuments = fetchTarsKnowledgeBaseDocuments,
): Promise<TarsDocument[]> {
  const cached = documentsCache.get(knowledgeBaseId);
  if (cached && Date.now() - cached.at < DOCUMENTS_TTL_MS) {
    return cached.documents;
  }
  const documents = list(knowledgeBaseId);
  documentsCache.set(knowledgeBaseId, { at: Date.now(), documents });
  documents.catch(() => documentsCache.delete(knowledgeBaseId));
  return documents;
}

/**
 * The stored file's path below pwc_tars's `/static`, as path segments, when it
 * sits inside its own knowledge base's upload folder; null for anything else
 * (no stored file, another knowledge base's folder, a path that climbs out).
 */
export function tarsSourceStaticSegments(
  filePath: string | null | undefined,
  knowledgeBaseId: string,
): string[] | null {
  if (!filePath || !knowledgeBaseId) {
    return null;
  }
  const normalized = posix.normalize(filePath.replace(/\\/g, '/'));
  const folder = `${UPLOADS_ROOT}/${knowledgeBaseId}/`;
  if (!normalized.startsWith(folder) || normalized.length === folder.length) {
    return null;
  }
  const segments = normalized.slice('apps/static/'.length).split('/');
  return segments.every((segment) => segment !== '' && segment !== '..') ? segments : null;
}

/**
 * The documents behind the cited file names, by name. A name is matched in
 * full against the searched knowledge bases; one carried by several documents
 * cannot say which was read, so it gets none.
 */
async function matchDocuments(
  knowledgeBaseIds: readonly string[],
  filenames: ReadonlySet<string>,
  list?: ListTarsDocuments,
): Promise<Map<string, TarsDocument>> {
  const listings = await Promise.all(
    knowledgeBaseIds.map((id) => listTarsSourceDocuments(id, list)),
  );
  const matches = new Map<string, TarsDocument[]>();
  listings.forEach((documents, index) => {
    for (const document of documents) {
      if (!filenames.has(document.filename)) {
        continue;
      }
      const owned = { ...document, knowledge_base_ids: knowledgeBaseIds[index] };
      matches.set(document.filename, [...(matches.get(document.filename) ?? []), owned]);
    }
  });
  const unique = new Map<string, TarsDocument>();
  for (const [filename, documents] of matches) {
    if (documents.length === 1) {
      unique.set(filename, documents[0]);
    }
  }
  return unique;
}

export interface TarsSourceLinkInput {
  /** The agent that offers the files; the relay re-reads its switch on every download. */
  agentId: string;
  /** The knowledge bases the search ran against. */
  knowledgeBaseIds: readonly string[];
  /** The file names the search cited, exactly as pwc_tars reports them. */
  filenames: readonly string[];
}

/**
 * Signed download links for the cited files that are stored originals: cited
 * name → relay link. Website pages and anything without a stored file get no
 * entry. Fail-soft: the answer stands without links when pwc_tars cannot list.
 */
export async function resolveTarsSourceLinks(
  input: TarsSourceLinkInput,
  list?: ListTarsDocuments,
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const filenames = new Set(input.filenames.filter(Boolean));
  if (!input.agentId || filenames.size === 0 || input.knowledgeBaseIds.length === 0) {
    return links;
  }
  try {
    const documents = await matchDocuments(input.knowledgeBaseIds, filenames, list);
    for (const [filename, document] of documents) {
      const knowledgeBaseId = document.knowledge_base_ids ?? '';
      if (!tarsSourceStaticSegments(document.file_path, knowledgeBaseId)) {
        continue;
      }
      const url = tarsSourceFileUrl({
        agentId: input.agentId,
        knowledgeBaseId,
        documentId: document.id,
      });
      if (url) {
        links.set(filename, url);
      }
    }
  } catch (error) {
    logger.warn('[tars-sources] Could not list knowledge-base documents; no download links', error);
  }
  return links;
}
