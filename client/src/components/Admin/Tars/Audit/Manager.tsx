import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger, useToastContext } from '@librechat/client';
import type { TTarsAuditQuery } from 'librechat-data-provider';
import type { ResponsePair } from './ResponseDialog';
import type { FilterState } from './Filters';
import {
  DEFAULT_FEEDBACK_COLUMNS,
  DEFAULT_REPORT_COLUMNS,
  FEEDBACK_COLUMNS,
  REPORT_COLUMNS,
  feedbackTotals,
  latestFeedbackRows,
} from './helpers';
import { useTarsAuditOptionsQuery, useTarsAuditReportQuery } from '~/data-provider';
import Filters, { initialFilters } from './Filters';
import ResponseDialog from './ResponseDialog';
import Statistics from './Statistics';
import { useLocalize } from '~/hooks';
import AuditTable from './Table';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-3 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';

const toQuery = (filters: FilterState): TTarsAuditQuery => ({
  start_date: filters.start,
  end_date: filters.end,
  filter_user_ids: filters.userIds,
  knowledge_base_ids: filters.knowledgeBaseIds,
  domain_id: filters.domainId,
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
  const [reportColumns, setReportColumns] = useState<string[]>(DEFAULT_REPORT_COLUMNS);
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

  const feedbackRows = useMemo(
    () => latestFeedbackRows(report?.data ?? [], report?.feedback_data ?? []),
    [report],
  );

  /**
   * The feedback filter is applied here rather than upstream: pwc_tars has no
   * such parameter, and the rows it needs are already in the response.
   */
  const reportRows = useMemo(() => {
    const rows = report?.data ?? [];
    if (!feedbackOnly) {
      return rows;
    }
    const rated = new Set(feedbackRows.map((row) => row.message_id));
    return rows.filter((row) => rated.has(row.message_id));
  }, [report, feedbackOnly, feedbackRows]);

  const totals = useMemo(() => feedbackTotals(feedbackRows), [feedbackRows]);
  const isLoading = reportQuery.isFetching;
  const hasRun = submitted != null;

  const runSearch = () => {
    setFeedbackOnly(filters.feedbackOnly);
    setSubmitted(toQuery(filters));
  };

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
      />

      <Tabs defaultValue="report">
        <TabsList className="w-fit">
          <TabsTrigger value="report" className={TAB_TRIGGER}>
            {localize('com_ui_tars_audit_tab_report')}
            {hasRun ? ` (${reportRows.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="feedback" className={TAB_TRIGGER}>
            {localize('com_ui_tars_audit_tab_feedback')}
            {hasRun ? ` (${feedbackRows.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="stats" className={TAB_TRIGGER}>
            {localize('com_ui_tars_audit_tab_stats')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="report" className={TAB_PANEL}>
          <AuditTable
            rows={reportRows}
            columns={REPORT_COLUMNS}
            visible={reportColumns}
            onVisibleChange={setReportColumns}
            isLoading={isLoading}
            locale={i18n.language}
            onViewResponse={setPair}
            exportName="AuditReport"
            emptyHint={emptyHint}
          />
        </TabsContent>

        <TabsContent value="feedback" className={TAB_PANEL}>
          <AuditTable
            rows={feedbackRows}
            columns={FEEDBACK_COLUMNS}
            visible={feedbackColumns}
            onVisibleChange={setFeedbackColumns}
            isLoading={isLoading}
            locale={i18n.language}
            onViewResponse={setPair}
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
            <div className="py-12 text-center text-sm text-text-secondary">{emptyHint}</div>
          )}
        </TabsContent>
      </Tabs>

      <ResponseDialog pair={pair} onClose={() => setPair(null)} />
    </div>
  );
}
