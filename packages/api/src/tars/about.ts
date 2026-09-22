// Destination: packages/api/src/tars/about.ts
// (same folder as tickets.ts, so the `./client` import below matches)

import { tarsFetch } from './client';

/** One published release note, as pwc_tars's `SysReleaseNotes.to_dict()` returns it. */
export interface TarsReleaseNote {
  id: string;
  version: string;
  title: string;
  content: string;
  created_at: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  is_published: boolean;
}

/**
 * `/home/get_release_notes` predates the `/api/settings/...` ticket routes and
 * answers with a `status` string rather than the ticket envelope's boolean
 * `success`, plus a `count` this caller doesn't need.
 */
interface TarsReleaseNotesEnvelope {
  status?: string;
  data?: TarsReleaseNote[];
  count?: number;
}

/**
 * Published release notes for the About page, newest first (pwc_tars sorts by
 * `created_at desc`). The About page only ever wants the published set, so
 * `version`/`title` filtering — which the endpoint also supports — isn't
 * exposed here. Returns [] rather than throwing on a malformed envelope, since
 * the page's SBOM section must stay usable even if this section degrades.
 */
export async function fetchTarsReleaseNotes(baseUrl?: string): Promise<TarsReleaseNote[]> {
  const response = await tarsFetch<TarsReleaseNotesEnvelope>('/api/home/get_release_notes', {
    query: { is_published: true },
    baseUrl,
  });
  if (response?.status !== 'success') {
    return [];
  }
  return response.data ?? [];
}
