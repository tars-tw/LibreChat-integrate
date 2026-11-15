import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger, useToastContext } from '@librechat/client';
import type { TTarsAuditQuery } from 'librechat-data-provider';
import type { ResponsePair } from './ResponseDialog';
import type { FilterState } from './Filters';
import {
  agentLabel,
  MESSAGE_COLUMNS,
  feedbackTotals,
  FEEDBACK_COLUMNS,
  groupConversations,
  latestFeedbackRows,
  DEFAULT_MESSAGE_COLUMNS,
  DEFAULT_FEEDBACK_COLUMNS,
} from './helpers';
import { useTarsAuditOptionsQuery, useTarsAuditReportQuery } from '~/data-provider';
import Filters, { initialFilters } from './Filters';
import ConversationTable from './Conversations';
import ResponseDialog from './ResponseDialog';
import { TraceDialog } from './Trace';
import Statistics from './Statistics';
import { useLocalize } from '~/hooks';
import AuditTable from './Table';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-3 p-0';
/**
 * The table panels stay mounted, so their expanded rows and pages survive a look at
 * another tab; only a new result set resets them. Radix never sets `hidden` on a
 * force-mounted panel, so the inactive state hides it here.
 */
const KEPT_TAB_PANEL = `${TAB_PANEL} data-[state=inactive]:hidden`;

const toQuery = (filters: FilterState): TTarsAuditQuery => ({
  start_date: filters.start,
  end_date: filters.end,
  filter_user_ids: filters.userIds,
  agent_ids: filters.agentIds,
  knowledge_base_ids: filters.knowledgeBaseIds,
  query_filter: filters.keyword.trim(),
});

/** Message audit report (訊息稽核報表): filters on top, three result tabs below. */
export default function AuditManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const [filters, setFilters] = useState<FilterState>(initialFilters);
  /** Null until the operator runs a search, which is what gates the query. */
  const [submitted, setSubmitted] = useState<TTarsAuditQuery | null>(null);
  const [feedbackOnly, setFeedbackOnly] = useState(false);
  const [pair, setPair] = useState<ResponsePair | null>(null);
  const [traceMessageId, setTraceMessageId] = useState<string | null>(null);
  const [messageColumns, setMessageColumns] = useState<string[]>(DEFAULT_MESSAGE_COLUMNS);
  const [feedbackColumns, setFeedbackColumns] = useState<string[]>(DEFAULT_FEEDBACK_COLUMNS);

  const optionsQuery = useTarsAuditOptionsQuery();
  const reportQuery = useTarsAuditReportQuery(submitted);

  useEffect(() => {
    if (optionsQuery.error != null) {
      showToast({
        message: localize('com_ui_tars_audit_options_failed'),
        status: 'error',
      });
    }
  }, [optionsQuery.error, showToast, localize]);

  useEffect(() => {
    if (reportQuery.error != null) {
      showToast({
        message: localize('com_ui_tars_audit_query_failed'),
        status: 'error',
      });
    }
  }, [reportQuery.error, showToast, localize]);

  const report = reportQuery.data;

  const feedbackRows = useMemo(() => latestFeedbackRows(report?.data ?? []), [report]);

  /**
   * The feedback filter is applied here rather than upstream: pwc_tars has no
   * such parameter, and the rows it needs are already in the response. Messages
   * are filtered before grouping, so a conversation with no rated message drops out.
   */
  const conversations = useMemo(() => {
    const rows = report?.data ?? [];
    if (!feedbackOnly) {
      return groupConversations(rows);
    }
    const rated = new Set(feedbackRows.map((row) => row.message_id));
    return groupConversations(rows.filter((row) => rated.has(row.message_id)));
  }, [report, feedbackOnly, feedbackRows]);

  const totals = useMemo(() => feedbackTotals(feedbackRows), [feedbackRows]);
  const isLoading = reportQuery.isFetching;
  const hasRun = submitted != null;

  /** Searching again with the same filters must still read the latest records. */
  const runSearch = () => {
    const query = toQuery(filters);
    setFeedbackOnly(filters.feedbackOnly);
    if (submitted != null && JSON.stringify(query) === JSON.stringify(submitted)) {
      reportQuery.refetch();
      return;
    }
    setSubmitted(query);
  };

  /** Deleted agents keep their history; the picker offers the ones this result named. */
  const missingAgents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of report?.data ?? []) {
      if (row.agent_id != null && row.agent_name == null && !seen.has(row.agent_id)) {
        seen.set(row.agent_id, agentLabel(row, localize));
      }
    }
    return [...seen].map(([id, label]) => ({ id, label }));
  }, [report, localize]);

  const emptyHint = hasRun
    ? localize('com_ui_tars_audit_no_data')
    : localize('com_ui_tars_audit_prompt');

  return (
    <div className="space-y-4">
      <Filters
        filters={filters}
        onChange={setFilters}
        onSubmit={runSearch}
        isLoading={isLoading}
        options={optionsQuery.data}
        optionsLoading={optionsQuery.isFetching}
        missingAgents={missingAgents}
      />

      <Tabs defaultValue="report">
        <TabsList variant="underline">
          <TabsTrigger value="report" variant="underline">
            {localize('com_ui_tars_audit_tab_report')}
            {hasRun ? ` (${conversations.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="feedback" variant="underline">
            {localize('com_ui_tars_audit_tab_feedback')}
            {hasRun ? ` (${feedbackRows.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="stats" variant="underline">
            {localize('com_ui_tars_audit_tab_stats')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="report" className={KEPT_TAB_PANEL} forceMount>
          <ConversationTable
            conversations={conversations}
            columns={MESSAGE_COLUMNS}
            visible={messageColumns}
            onVisibleChange={setMessageColumns}
            isLoading={isLoading}
            locale={i18n.language}
            onViewResponse={setPair}
            onViewTrace={setTraceMessageId}
            exportName="AuditReport"
            emptyHint={emptyHint}
          />
        </TabsContent>

        <TabsContent value="feedback" className={KEPT_TAB_PANEL} forceMount>
          <AuditTable
            rows={feedbackRows}
            columns={FEEDBACK_COLUMNS}
            visible={feedbackColumns}
            onVisibleChange={setFeedbackColumns}
            isLoading={isLoading}
            locale={i18n.language}
            onViewResponse={setPair}
            onViewTrace={setTraceMessageId}
            exportName="FeedbackReport"
            emptyHint={emptyHint}
          />
        </TabsContent>

        <TabsContent value="stats" className={TAB_PANEL}>
          {hasRun ? (
            <Statistics
              summary={report?.summary ?? null}
              details={report?.details ?? []}
              likes={totals.likes}
              dislikes={totals.dislikes}
            />
          ) : (
            <div className="text-text-secondary py-12 text-center text-sm">{emptyHint}</div>
          )}
        </TabsContent>
      </Tabs>

      <ResponseDialog pair={pair} onClose={() => setPair(null)} />
      {traceMessageId != null && (
        <TraceDialog messageId={traceMessageId} onClose={() => setTraceMessageId(null)} />
      )}
    </div>
  );
}
