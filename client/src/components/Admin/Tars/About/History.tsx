import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button, Spinner } from '@librechat/client';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import type { ReleaseNote } from './helpers';
import { formatDate, filterNotes, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from './helpers';
import { useLocalize } from '~/hooks';

const markdownComponents = {
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="my-3 border-l-2 border-orange-400 pl-2.5 text-sm font-medium text-text-primary">
      {children}
    </h2>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-1 pl-4">{children}</ul>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2">{children}</p>,
};

/**
 * Version history: a searchable, paged list on the left, the selected note's
 * content on the right. Layout mirrors the Comments/History split-panel style.
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

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center gap-2 rounded-lg border border-border-light text-sm text-text-secondary">
        <Spinner className="size-4" />
        {localize('com_ui_loading')}
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center gap-2 rounded-lg border border-border-light text-sm text-text-secondary">
        <Inbox className="size-6" aria-hidden />
        {localize('com_ui_tars_about_no_notes')}
      </div>
    );
  }

  return (
    <div className="grid min-h-[24rem] overflow-hidden rounded-lg border border-border-light md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col border-b border-border-light bg-surface-secondary md:border-b-0 md:border-r">
        <div className="border-b border-border-light p-2">
          <input
            type="text"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder={localize('com_ui_tars_about_search_placeholder')}
            className="w-full rounded-md border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary outline-none"
          />
        </div>

        <ul className="flex-1 overflow-y-auto">
          {paged.length === 0 ? (
            <li className="p-3 text-xs text-text-secondary">
              {localize('com_ui_tars_about_no_matching_notes')}
            </li>
          ) : (
            paged.map((note) => {
              const active = selected?.id === note.id;
              const isLatest = notes[0]?.id === note.id;
              return (
                <li key={note.id} className="border-b border-border-light last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    aria-pressed={active}
                    className={`w-full px-3 py-2 text-left transition-colors hover:bg-surface-tertiary ${
                      active ? 'bg-surface-primary' : ''
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {note.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-xs text-text-secondary">{note.version}</span>
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

        <div className="flex items-center justify-between gap-2 border-t border-border-light p-2">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="rounded-md border border-border-light bg-surface-primary px-1 py-0.5 text-xs text-text-secondary"
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
              <span className="text-xs text-text-secondary">
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
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border-light pb-3">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                {selected.version}
              </span>
              <span className="text-sm font-medium text-text-primary">{selected.title}</span>
              <span className="ml-auto text-xs text-text-secondary">
                {formatDate(selected.created_at)}
              </span>
            </div>
            <div className="text-sm leading-7 text-text-secondary">
              <ReactMarkdown components={markdownComponents}>
                {selected.content?.replace(/^\n/, '') ?? ''}
              </ReactMarkdown>
            </div>
          </>
        ) : (
          <p className="pt-16 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_about_select_version')}
          </p>
        )}
      </div>
    </div>
  );
}
