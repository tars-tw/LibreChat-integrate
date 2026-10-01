import type { TarsDatasetWebsite } from './datasets';
import { deleteTarsWebsiteDataset } from './datasets';
import { tarsFetch } from './client';

/**
 * A row of the 外部網站 master list.
 *
 * pwc_tars returns every knowledge base the website is bound to. Importing the
 * same URL into another base reuses this row and adds a relation.
 */
export interface TarsWebsiteSource extends TarsDatasetWebsite {
  knowledge_base_ids: string[];
  knowledge_base_names: string[];
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
 * knowledge-base endpoint clears (and it removes the dataset itself once the
 * last relation is gone). An unbound row has none, and that endpoint would
 * fail looking for the relation, so it is deleted directly. The caller states
 * which it is; picking the path is not the browser's job.
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

export interface TarsWebsiteUpdate {
  name: string;
  description?: string;
  url?: string;
  status?: 0 | 1;
  knowledgeBaseIds?: string[];
}

interface WebsiteUpdateResponse {
  dataset_website?: TarsDatasetWebsite | null;
  kb_ids_to_import?: string[];
}

/**
 * Updates a website and syncs its knowledge-base bindings
 * pwc_tars unbinds the removed bases itself (without deleting the dataset) but
 * does not import into the added ones; it reports them in `kb_ids_to_import`
 * and the caller imports them one at a time.
 */
export async function updateTarsWebsite(
  tarsId: string,
  websiteId: string,
  data: TarsWebsiteUpdate,
  baseUrl?: string,
): Promise<{ website: TarsDatasetWebsite | null; kbIdsToImport: string[] }> {
  const res = await tarsFetch<WebsiteUpdateResponse>(
    `/api/dataset_website/update_dataset_website/${encodeURIComponent(websiteId)}`,
    {
      method: 'PUT',
      body: {
        name: data.name,
        description: data.description,
        url: data.url,
        status: data.status,
        knowledge_base_ids: data.knowledgeBaseIds ?? [],
        updated_by: tarsId,
      },
      baseUrl,
    },
  );
  return { website: res?.dataset_website ?? null, kbIdsToImport: res?.kb_ids_to_import ?? [] };
}

/**
 * Creates a website dataset without binding or crawling it
 */
export async function createTarsWebsiteRecord(
  tarsId: string,
  data: { name: string; url: string; description?: string; status?: 0 | 1 },
  baseUrl?: string,
): Promise<TarsDatasetWebsite | null> {
  const res = await tarsFetch<{ dataset_website?: TarsDatasetWebsite }>(
    '/api/dataset_website/create_dataset_website',
    {
      method: 'POST',
      body: { ...data, created_by: tarsId },
      baseUrl,
    },
  );
  return res?.dataset_website ?? null;
}
