import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button, Spinner } from '@librechat/client';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { ReleaseNote } from './helpers';
import {
  formatDate,
  filterNotes,
  parseReleaseNote,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from './helpers';
import { useLocalize } from '~/hooks';

const SectionTitle = ({ children }: { children?: React.ReactNode }) => (
  <h2 className="text-text-primary my-3 border-l-2 border-orange-400 pl-2.5 text-sm font-medium">
    {children}
  </h2>
);

const markdownComponents = {
  h2: SectionTitle,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-1 pl-4">{children}</ul>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2">{children}</p>,
};

/**
 * Version history: a searchable, paged list on the left, the selected note's
 * content on the right. Layout mirrors the Comments/History split-panel style;
 * a note's `##` sections are laid out as cards in two columns on wide screens.
 */
export default function History({
  notes,
  isLoading,
}: {
  notes: ReleaseNote[];
  isLoading: boolean;
}) {
  const localize = useLocalize();
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => filterNotes(notes, query), [notes, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );
  const selected = notes.find((note) => note.id === selectedId) ?? notes[0] ?? null;
  const parsed = useMemo(
    () => (selected ? parseReleaseNote(selected.content ?? '') : null),
    [selected],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="border-border-light text-text-secondary flex min-h-[24rem] items-center justify-center gap-2 rounded-lg border text-sm">
        <Spinner className="size-4" />
        {localize('com_ui_loading')}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="border-border-light text-text-secondary flex min-h-[24rem] flex-col items-center justify-center gap-2 rounded-lg border text-sm">
        <Inbox className="size-6" aria-hidden />
        {localize('com_ui_tars_about_no_notes')}
      </div>
    );
  }

  return (
    <div className="border-border-light grid min-h-[24rem] overflow-hidden rounded-lg border md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="border-border-light bg-surface-secondary flex flex-col border-b md:border-r md:border-b-0">
        <div className="border-border-light border-b p-2">
          <input
            type="text"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder={localize('com_ui_tars_about_search_placeholder')}
            className="border-border-light bg-surface-primary text-text-primary w-full rounded-md border px-2 py-1 text-xs outline-none"
          />
        </div>

        <ul className="flex-1 overflow-y-auto">
          {paged.length === 0 ? (
            <li className="text-text-secondary p-3 text-xs">
              {localize('com_ui_tars_about_no_matching_notes')}
            </li>
          ) : (
            paged.map((note) => {
              const active = selected?.id === note.id;
              const isLatest = notes[0]?.id === note.id;
              return (
                <li key={note.id} className="border-border-light border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    aria-pressed={active}
                    className={`hover:bg-surface-tertiary w-full px-3 py-2 text-left transition-colors ${
                      active ? 'bg-surface-primary' : ''
                    }`}
                  >
                    <span className="text-text-primary block truncate text-sm font-medium">
                      {note.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-text-secondary text-xs">{note.version}</span>
                      {isLatest && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                          {localize('com_ui_tars_about_latest')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-border-light flex items-center justify-between gap-2 border-t p-2">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="border-border-light bg-surface-primary text-text-secondary rounded-md border px-1 py-0.5 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {localize('com_ui_tars_about_per_page', { 0: String(size) })}
              </option>
            ))}
          </select>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label={localize('com_ui_tars_users_prev_page')}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <span className="text-text-secondary text-xs">
                {currentPage}/{totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label={localize('com_ui_tars_users_next_page')}
              >
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-y-auto p-5">
        {selected ? (
          <>
            <div className="border-border-light mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {selected.version}
              </span>
              <span className="text-text-primary text-sm font-medium">{selected.title}</span>
              <span className="text-text-secondary ml-auto text-xs">
                {formatDate(selected.created_at)}
              </span>
            </div>
            {parsed != null && parsed.intro !== '' && (
              <div className="text-text-secondary text-sm leading-7">
                <ReactMarkdown components={markdownComponents}>{parsed.intro}</ReactMarkdown>
              </div>
            )}
            {parsed != null && parsed.sections.length > 0 && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {parsed.sections.map((section, index) => (
                  <div key={index} className="bg-surface-primary rounded-lg px-3 pb-1">
                    <SectionTitle>{section.title}</SectionTitle>
                    <div className="text-text-secondary text-sm leading-7">
                      <ReactMarkdown components={markdownComponents}>
                        {section.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-text-secondary pt-16 text-center text-sm">
            {localize('com_ui_tars_about_select_version')}
          </p>
        )}
      </div>
    </div>
  );
}
