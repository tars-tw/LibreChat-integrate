import { Fragment, useId, useMemo, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { Check, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import type { AuditColumn, AuditConversation, CellFormat } from './helpers';
import type { ResponsePair } from './ResponseDialog';
import {
  cellText,
  agentLabel,
  PAGE_SIZES,
  CONVERSATION_COLUMNS,
  conversationCellText,
  CONVERSATION_PAGE_SIZE,
} from './helpers';
import { downloadBlob, formatDateTime, toCsvBlob } from '../Users/helpers';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';
import AuditCell from './Cell';
import Pager from './Pager';

interface MessageListProps {
  conversation: AuditConversation;
  columns: AuditColumn[];
  format: CellFormat;
  page: number;
  onPageChange: (page: number) => void;
  onViewResponse: (pair: ResponsePair) => void;
  onViewTrace?: (messageId: string) => void;
}

/** An expanded conversation's messages, ten at a time; no pager when they fit on one page. */
function MessageList({
  conversation,
  columns,
  format,
  page,
  onPageChange,
  onViewResponse,
  onViewTrace,
}: MessageListProps) {
  const localize = useLocalize();
  const { messages } = conversation;
  const totalPages = Math.max(1, Math.ceil(messages.length / CONVERSATION_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = messages.slice(
    (currentPage - 1) * CONVERSATION_PAGE_SIZE,
    currentPage * CONVERSATION_PAGE_SIZE,
  );

  /* `w-0 min-w-full` keeps the message table out of the outer table's width: it
     fills the conversation row and scrolls on its own, so a wide message column
     set neither pushes the conversation columns apart nor its pager off screen. */
  return (
    <div className="w-0 min-w-full space-y-2 py-2 pr-3 pl-10">
      <div className="border-border-light bg-surface-primary overflow-x-auto rounded-lg border">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead className="bg-surface-tertiary">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.field}
                  scope="col"
                  className="text-text-secondary px-3 py-1.5 text-left font-medium whitespace-nowrap"
                >
                  {localize(column.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={row.message_id}
                className="border-border-light hover:bg-surface-tertiary border-t align-top"
              >
                {columns.map((column) => (
                  <td key={column.field} className="text-text-primary px-3 py-1.5">
                    <AuditCell
                      row={row}
                      column={column}
                      format={format}
                      onViewResponse={onViewResponse}
                      onViewTrace={onViewTrace}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {messages.length > CONVERSATION_PAGE_SIZE && (
        <Pager
          page={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
          size="sm"
          indicator={localize('com_ui_tars_audit_inner_page_indicator', {
            0: String(currentPage),
            1: String(totalPages),
          })}
        />
      )}
    </div>
  );
}

/** The text a fixed conversation column shows; the deleted flag is an icon instead. */
function ConversationCell({
  conversation,
  column,
}: {
  conversation: AuditConversation;
  column: AuditColumn;
}) {
  const localize = useLocalize();
  if (column.field === 'is_deleted') {
    return conversation.is_deleted ? (
      <Check
        className="text-text-destructive size-4"
        aria-label={localize('com_ui_tars_audit_col_deleted')}
      />
    ) : null;
  }
  const text = conversationCellText(conversation, column, localize);
  if (column.kind === 'number') {
    return <span className="tabular-nums">{text}</span>;
  }
  if (column.field === 'conversation_name' && !conversation.conversation_name) {
    return <span className="text-text-secondary">{text}</span>;
  }
  return (
    <span className="block max-w-[22rem] truncate" title={text === '' ? undefined : text}>
      {text}
    </span>
  );
}

/**
 * The report tab: one row per conversation, each expanding to its matching
 * messages. Expanded state and each conversation's message page are tracked
 * per conversation, and a new result set resets all of them.
 */
export default function ConversationTable({
  conversations,
  columns,
  visible,
  onVisibleChange,
  isLoading,
  locale,
  onViewResponse,
  onViewTrace,
  exportName,
  emptyHint,
}: {
  conversations: AuditConversation[];
  /** The message columns an expanded conversation can show. */
  columns: AuditColumn[];
  visible: string[];
  onVisibleChange: (fields: string[]) => void;
  isLoading: boolean;
  locale: string;
  onViewResponse: (pair: ResponsePair) => void;
  onViewTrace?: (messageId: string) => void;
  exportName: string;
  emptyHint: string;
}) {
  const localize = useLocalize();
  const idPrefix = useId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [messagePages, setMessagePages] = useState<Readonly<Record<string, number>>>({});
  const [shownConversations, setShownConversations] = useState(conversations);

  /** Reset while rendering, so a new result set never paints with the old rows open. */
  if (shownConversations !== conversations) {
    setShownConversations(conversations);
    setPage(1);
    setExpanded(new Set());
    setMessagePages({});
  }

  const shown = useMemo(
    () => columns.filter((column) => column.locked === true || visible.includes(column.field)),
    [columns, visible],
  );

  const totalPages = Math.max(1, Math.ceil(conversations.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => conversations.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [conversations, currentPage, pageSize],
  );

  const format: CellFormat = {
    date: (value) => formatDateTime(value, locale),
    agent: (row) => agentLabel(row, localize),
    deletedUser: localize('com_ui_tars_audit_trace_user_deleted'),
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  /** One line per message, led by its conversation's columns, every column included. */
  const exportCsv = () => {
    const headers = [...CONVERSATION_COLUMNS, ...columns].map((column) =>
      localize(column.labelKey),
    );
    const body = conversations.flatMap((conversation) => {
      const lead = CONVERSATION_COLUMNS.map((column) =>
        conversationCellText(conversation, column, localize),
      );
      return conversation.messages.map((row) => [
        ...lead,
        ...columns.map((column) => cellText(row, column, format)),
      ]);
    });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadBlob(toCsvBlob(headers, body), `${exportName}_${stamp}.csv`);
  };

  return (
    <div className="space-y-2">
      <Toolbar
        columns={columns}
        visible={visible}
        onVisibleChange={onVisibleChange}
        onExport={exportCsv}
        canExport={conversations.length > 0}
        columnsHint={localize('com_ui_tars_audit_columns_hint_messages')}
      />

      <div className="data-table-scroll border-border-light max-h-[70vh] overflow-auto rounded-lg border">
        {isLoading && (
          <div className="text-text-secondary flex items-center justify-center gap-2 py-10 text-sm">
            <Spinner className="size-4" />
            {localize('com_ui_loading')}
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div className="text-text-secondary flex flex-col items-center gap-2 py-10 text-sm">
            <Inbox className="size-6" aria-hidden />
            {emptyHint}
          </div>
        )}

        {!isLoading && conversations.length > 0 && (
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-surface-secondary sticky top-0 z-10">
              <tr>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">{localize('com_ui_expand')}</span>
                </th>
                {CONVERSATION_COLUMNS.map((column) => (
                  <th
                    key={column.field}
                    scope="col"
                    className="text-text-secondary px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {localize(column.labelKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((conversation) => {
                const isOpen = expanded.has(conversation.id);
                const detailId = `${idPrefix}-${conversation.id}`;
                const name =
                  conversation.conversation_name ||
                  localize('com_ui_tars_audit_untitled_conversation');
                const Icon = isOpen ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={conversation.id}>
                    <tr
                      onClick={() => {
                        /** Selecting text to copy it is not a request to expand the row. */
                        if (window.getSelection()?.isCollapsed === false) {
                          return;
                        }
                        toggle(conversation.id);
                      }}
                      className="border-border-light hover:bg-surface-tertiary cursor-pointer border-t align-middle"
                    >
                      <td className="px-2 py-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? detailId : undefined}
                          aria-label={`${localize(isOpen ? 'com_ui_collapse' : 'com_ui_expand')} ${name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(conversation.id);
                          }}
                        >
                          <Icon className="text-text-secondary size-4" aria-hidden />
                        </Button>
                      </td>
                      {CONVERSATION_COLUMNS.map((column) => (
                        <td key={column.field} className="text-text-primary px-3 py-1.5">
                          <ConversationCell conversation={conversation} column={column} />
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr id={detailId} className="bg-surface-secondary">
                        <td colSpan={CONVERSATION_COLUMNS.length + 1} className="p-0">
                          <MessageList
                            conversation={conversation}
                            columns={shown}
                            format={format}
                            page={messagePages[conversation.id] ?? 1}
                            onPageChange={(next) =>
                              setMessagePages((current) => ({
                                ...current,
                                [conversation.id]: next,
                              }))
                            }
                            onViewResponse={onViewResponse}
                            onViewTrace={onViewTrace}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {conversations.length > 0 && (
        <Pager
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          indicator={localize('com_ui_tars_audit_page_indicator_conversations', {
            0: String(currentPage),
            1: String(totalPages),
            2: String(conversations.length),
          })}
        />
      )}
    </div>
  );
}
