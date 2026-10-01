import type { TTarsWebsiteSource } from 'librechat-data-provider';

export { NAME_MIN, NAME_MAX, nameInvalid, errorMessage } from '../Sources/helpers';

/** pwc_tars crawls over HTTP(S) only; anything else fails at fetch time. */
export const urlInvalid = (url: string): boolean => !/^https?:\/\/\S+$/.test(url.trim());

export const boundIds = (w: TTarsWebsiteSource): string[] => w.knowledge_base_ids ?? [];

export const boundNames = (w: TTarsWebsiteSource): string[] =>
  w.knowledge_base_names?.length ? w.knowledge_base_names : boundIds(w);

export interface WebsiteForm {
  knowledgeBaseIds: string[];
  name: string;
  url: string;
  description: string;
  enabled: boolean;
}

export const emptyWebsiteForm: WebsiteForm = {
  knowledgeBaseIds: [],
  name: '',
  url: '',
  description: '',
  enabled: true,
};

export const toWebsiteForm = (website: TTarsWebsiteSource): WebsiteForm => ({
  knowledgeBaseIds: boundIds(website),
  name: website.name ?? '',
  url: website.url ?? '',
  description: website.description ?? '',
  enabled: website.status !== 0,
});

/** Matches the original page: case-insensitive, across the fields on screen. */
export const filterWebsites = (
  websites: TTarsWebsiteSource[],
  search: string,
  knowledgeBaseId: string,
): TTarsWebsiteSource[] => {
  const query = search.trim().toLowerCase();
  return websites.filter((website) => {
    if (knowledgeBaseId !== '' && !boundIds(website).includes(knowledgeBaseId)) {
      return false;
    }
    if (query === '') {
      return true;
    }
    return [website.name, website.url, website.description].some(
      (field) => field != null && field.toLowerCase().includes(query),
    );
  });
};

export const knowledgeBasePickerOptions = (
  knowledgeBases: { id: string; name: string }[],
): { value: string; label: string }[] =>
  knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }));
