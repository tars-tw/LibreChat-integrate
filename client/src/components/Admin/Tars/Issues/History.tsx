import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { ChevronLeft, ChevronRight, Download, Inbox, RefreshCw } from 'lucide-react';
import type { TTarsTicket } from 'librechat-data-provider';
import { downloadBlob, formatDateTime, toCsvBlob } from '../Users/helpers';
import { badgeClasses, ticketBadge } from './helpers';
import { useLocalize } from '~/hooks';

/** Fallback row height for the first paint, before a real row can be measured. */
const ESTIMATED_ROW_HEIGHT = 76;
/** Matches the `space-y-1` between rows, in pixels. */
const ROW_GAP = 4;
/** Below this the list is not worth paging, so it scrolls instead. */
const MIN_PAGE_SIZE = 4;

/**
 * Ticket history. Paged locally because pwc_tars returns the operator's whole
 * list in one call, exactly as the original page did. The page size follows the
 * available height so the list fills the column without an inner scrollbar.
 */
export default function History({
  tickets,
  isLoading,
  selectedId,
  onSelect,
  onRefresh,
  locale,
  labelOf,
}: {
  tickets: TTarsTicket[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (ticket: TTarsTicket) => void;
  onRefresh: () => void;
  locale: string;
  labelOf: (field: 'types' | 'priorities', value: string | null | undefined) => string;
}) {
  const localize = useLocalize();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MIN_PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  /**
   * Rows are uniform, so one measured row divides the column cleanly. The
   * observed element keeps a fixed flex height, so resizing the page never
   * feeds back into the measurement.
   */
  useLayoutEffect(() => {
    const container = listRef.current;
    if (container == null) {
      return;
    }
    const measure = () => {
      const rowHeight = rowRef.current?.offsetHeight ?? ESTIMATED_ROW_HEIGHT;
      const fits = Math.floor(container.clientHeight / (rowHeight + ROW_GAP));
      setPageSize(Math.max(MIN_PAGE_SIZE, fits));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tickets.length]);

  const totalPages = Math.max(1, Math.ceil(tickets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => tickets.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [tickets, currentPage, pageSize],
  );

  const statusLabel = (ticket: TTarsTicket): string => {
    const badge = ticketBadge(ticket);
    return badge.labelKey != null ? localize(badge.labelKey) : (badge.rawLabel ?? '');
  };

  /** Exports every ticket, not just the visible page, as the original did. */
  const exportCsv = () => {
    const headers = [
      localize('com_ui_tars_issues_col_key'),
      localize('com_ui_tars_issues_field_title'),
      localize('com_ui_tars_users_status'),
      localize('com_ui_tars_issues_field_type'),
      localize('com_ui_tars_issues_field_priority'),
      localize('com_ui_tars_issues_field_description'),
      localize('com_ui_tars_issues_col_attachments'),
      localize('com_ui_tars_issues_col_created_at'),
    ];
    const rows = tickets.map((ticket) => [
      ticket.jira_ticket_key ?? '',
      ticket.title,
      statusLabel(ticket),
      labelOf('types', ticket.category),
      labelOf('priorities', ticket.priority),
      ticket.description ?? '',
      String(ticket.attachments?.length ?? 0),
      formatDateTime(ticket.created_at, locale),
    ]);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadBlob(toCsvBlob(headers, rows), `SupportTickets_${stamp}.csv`);
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border-light">
      <header className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-3">
        <h2 className="text-base font-medium text-text-primary">
          {localize('com_ui_tars_issues_history')}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={exportCsv}
            disabled={tickets.length === 0}
            aria-label={localize('com_ui_tars_issues_export')}
            title={localize('com_ui_tars_issues_export')}
          >
            <Download className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={localize('com_ui_refresh')}
            title={localize('com_ui_refresh')}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && tickets.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
            <Spinner className="size-4" />
            {localize('com_ui_loading')}
          </div>
        )}

        {!isLoading && tickets.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-text-secondary">
            <Inbox className="size-6" aria-hidden />
            {localize('com_ui_tars_issues_empty')}
          </div>
        )}

        {paged.length > 0 && (
          <ul className="space-y-1">
            {paged.map((ticket, index) => {
              const badge = ticketBadge(ticket);
              const active = selectedId === ticket.id;
              return (
                <li key={ticket.id} ref={index === 0 ? rowRef : undefined}>
                  <button
                    type="button"
                    onClick={() => onSelect(ticket)}
                    aria-pressed={active}
                    title={localize('com_ui_tars_issues_load_into_form')}
                    className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-tertiary ${
                      active ? 'bg-surface-tertiary' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">
                        {ticket.title}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {formatDateTime(ticket.created_at, locale)}
                        {ticket.jira_ticket_key != null && ticket.jira_ticket_key !== ''
                          ? ` ｜ ${ticket.jira_ticket_key}`
                          : ''}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {labelOf('types', ticket.category)}
                        {ticket.priority != null && ticket.priority !== ''
                          ? ` ｜ ${labelOf('priorities', ticket.priority)}`
                          : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${badgeClasses(badge.tone)}`}
                      >
                        {badge.labelKey != null ? localize(badge.labelKey) : badge.rawLabel}
                      </span>
                      {active && (
                        <span className="mt-1 block text-xs text-text-secondary">
                          {localize('com_ui_tars_issues_viewing')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <footer className="flex items-center justify-between gap-2 border-t border-border-light px-4 py-2">
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
            {localize('com_ui_tars_issues_page_indicator', {
              0: String(currentPage),
              1: String(totalPages),
              2: String(tickets.length),
            })}
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
        </footer>
      )}
    </section>
  );
}
