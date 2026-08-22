import type { TarsDatasetWebsite } from './datasets';
import { deleteTarsWebsiteDataset } from './datasets';
import { tarsFetch } from './client';

/**
 * A row of the 外部網站 master list.
 *
 * pwc_tars joins the knowledge base in from `dataset_website_to_knowledge_base`
 * and only ever reports the first relation, so a website belongs to at most
 * one base here. Importing the same URL into a second base creates a second
 * row upstream rather than a second relation on this one.
 */
export interface TarsWebsiteSource extends TarsDatasetWebsite {
  knowledge_base_id: string | null;
  knowledge_base_name: string | null;
}

/** The knowledge bases a website may be imported into (enabled ones only). */
export interface TarsWebsiteTarget {
  id: string;
  name: string;
}

export interface TarsWebsiteList {
  websites: TarsWebsiteSource[];
  knowledgeBases: TarsWebsiteTarget[];
}

interface WebsiteListResponse {
  dataset_websites?: TarsWebsiteSource[];
  knowledge_bases?: { id?: string; name?: string }[];
}

/**
 * Every website dataset, with its knowledge base and the import targets
 * (`GET /api/dataset_website/get_dataset_websites`). The targets ride along in
 * the same response, so the create form costs no extra request.
 */
export async function fetchTarsWebsites(baseUrl?: string): Promise<TarsWebsiteList> {
  const data = await tarsFetch<WebsiteListResponse>('/api/dataset_website/get_dataset_websites', {
    baseUrl,
  });
  return {
    websites: data?.dataset_websites ?? [],
    knowledgeBases: (data?.knowledge_bases ?? [])
      .filter((kb): kb is { id: string; name: string } => kb?.id != null && kb.name != null)
      .map((kb) => ({ id: kb.id, name: kb.name })),
  };
}

/**
 * Deletes a website dataset.
 *
 * A bound row has crawled chunks and vectors behind it, which only the
 * knowledge-base endpoint clears; an unbound row (created before a knowledge
 * base was mandatory) has none, and that endpoint would fail looking for the
 * relation. The caller states which it is; picking the path is not the
 * browser's job.
 */
export async function deleteTarsWebsite(
  tarsId: string,
  websiteId: string,
  knowledgeBaseId: string | null,
  baseUrl?: string,
): Promise<void> {
  if (knowledgeBaseId != null && knowledgeBaseId !== '') {
    await deleteTarsWebsiteDataset(tarsId, knowledgeBaseId, websiteId, baseUrl);
    return;
  }
  await tarsFetch(`/api/dataset_website/delete_dataset_website/${encodeURIComponent(websiteId)}`, {
    method: 'DELETE',
    query: { operator_id: tarsId },
    baseUrl,
  });
}
