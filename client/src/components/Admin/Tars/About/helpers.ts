export interface ReleaseNote {
  id: string;
  version: string;
  title: string;
  content: string;
  created_at: string;
}

export const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 50];
export const DEFAULT_PAGE_SIZE = 5;

export const formatDate = (isoString: string | null | undefined): string => {
  if (isoString == null || isoString === '') {
    return '';
  }
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

/** Matches on title or content, same as the original inline filter. */
export const filterNotes = (notes: ReleaseNote[], query: string): ReleaseNote[] => {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return notes;
  }
  return notes.filter(
    (note) => note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q),
  );
};

export interface SbomFile {
  key: string;
  filename: string;
}

/** The two artifacts published alongside each release. */
export const SBOM_FILES: SbomFile[] = [
  { key: 'backend', filename: 'backend-sbom.json' },
  { key: 'frontend', filename: 'frontend-sbom.json' },
];
