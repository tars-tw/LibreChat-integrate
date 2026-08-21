import { highlightParts } from './chunks';

/**
 * The search term, marked up inside the surrounding text.
 *
 * Built from React nodes rather than an HTML string — chunk content comes from
 * uploaded files and crawled pages, so it is never trusted markup.
 */
export default function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark
            key={`${index}-${part.text}`}
            className="rounded-sm bg-brand-primary/25 text-inherit"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        ),
      )}
    </>
  );
}
