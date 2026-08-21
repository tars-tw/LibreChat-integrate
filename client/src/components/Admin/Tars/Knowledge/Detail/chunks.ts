import type { TTarsChunk, TTarsWebsiteChunk } from 'librechat-data-provider';
import type { ReactNode } from 'react';

/**
 * What the chunk viewer needs, regardless of where the chunk came from.
 *
 * pwc_tars keeps document and website chunks in separate tables whose rows are
 * identical apart from what they belong to, so both map onto this.
 */
export interface ViewerChunk {
  id: string;
  position: number;
  content: string;
  word_count: number | null;
  tokens: number | null;
  hit_count: number | null;
}

export const documentChunk = (chunk: TTarsChunk): ViewerChunk => ({
  id: chunk.id,
  position: chunk.position,
  content: chunk.content,
  word_count: chunk.word_count ?? null,
  tokens: chunk.tokens ?? null,
  hit_count: chunk.hit_count ?? null,
});

export const websiteChunk = (chunk: TTarsWebsiteChunk): ViewerChunk => ({
  id: chunk.id,
  position: chunk.position,
  content: chunk.content,
  word_count: chunk.word_count,
  tokens: chunk.tokens,
  hit_count: chunk.hit_count,
});

/** A conservative test for content worth handing to the markdown renderer. */
export const looksLikeMarkdown = (text: string): boolean =>
  /^#{1,6}\s|^\s*[-*]\s|\*\*|```|^>\s|\[.+\]\(.+\)/m.test(text);

/** Escapes the characters that would otherwise make the query a pattern. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits text around the search term.
 *
 * Returns the pieces rather than HTML: chunk content is whatever was in the
 * uploaded file, so it must never reach `dangerouslySetInnerHTML`.
 */
export const highlightParts = (text: string, query: string): { text: string; match: boolean }[] => {
  const needle = query.trim();
  if (needle === '') {
    return [{ text, match: false }];
  }
  return text
    .split(new RegExp(`(${escapeRegExp(needle)})`, 'gi'))
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: part.toLowerCase() === needle.toLowerCase() }));
};

/** Trims a preview without cutting the highlight logic off from the full text. */
export const preview = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;

export type { ReactNode };
