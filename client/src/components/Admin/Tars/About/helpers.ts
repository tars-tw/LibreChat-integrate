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

/** Matches on version, title or content; the search box is labelled as a version search. */
export const filterNotes = (notes: ReleaseNote[], query: string): ReleaseNote[] => {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return notes;
  }
  return notes.filter((note) =>
    [note.version, note.title, note.content].some((field) =>
      (field ?? '').toLowerCase().includes(q),
    ),
  );
};

export interface ReleaseSection {
  title: string;
  content: string;
}

/**
 * Splits a release note into the text before its first `##` heading and one
 * section per `##` heading. The top-level `# ` title is dropped because the
 * header already shows the version and title.
 */
export const parseReleaseNote = (
  content: string,
): { intro: string; sections: ReleaseSection[] } => {
  const [intro, ...chunks] = content
    .replace(/^# .+$(\r?\n)?/m, '')
    .trim()
    .split(/^## /m);
  return {
    intro: intro.trim(),
    sections: chunks.map((chunk) => {
      const [title, ...lines] = chunk.split(/\r?\n/);
      return { title: title.trim(), content: lines.join('\n').trim() };
    }),
  };
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
