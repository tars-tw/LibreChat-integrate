import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastContext } from '@librechat/client';
import { dataService } from 'librechat-data-provider';
import type { TTarsActionLog, TTarsActionLogQuery } from 'librechat-data-provider';
import type { TimelineTarget } from './TimelineDialog';
import type { OpsFilterState } from './Filters';
import { useTarsOperationLogOptionsQuery, useTarsOperationLogsQuery } from '~/data-provider';
import { downloadBlob, formatDateTime, toCsvBlob } from '../Users/helpers';
import { actionConfig, moduleLabel, EXPORT_LIMIT } from './helpers';
import Filters, { initialOpsFilters } from './Filters';
import TimelineDialog from './TimelineDialog';
import DetailDialog from './DetailDialog';
import OperationsTable from './Table';
import { useLocalize } from '~/hooks';
import Summary from './Summary';

const EMPTY_SUMMARY = {
  total: 0,
  create: 0,
  update: 0,
  delete: 0,
  read: 0,
  export: 0,
  download: 0,
  login: 0,
  logout: 0,
  other: 0,
};

const toQuery = (filters: OpsFilterState, page: number, pageSize: number): TTarsActionLogQuery => ({
  start_date: filters.start,
  end_date: filters.end,
  user_ids: filters.userIds,
  action_types: filters.actionTypes,
  modules: filters.modules,
  keyword: filters.keyword.trim(),
  page,
  page_size: pageSize,
});

/** System operation audit (系統操作稽核): filters, totals, then the trail. */
export default function OperationsManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const [filters, setFilters] = useState<OpsFilterState>(initialOpsFilters);
  /**
   * The filters the trail is actually showing. Separate from the draft above so
   * typing in the keyword box does not re-query on every keystroke — this
   * endpoint counts nine aggregates per request.
   */
  const [applied, setApplied] = useState<OpsFilterState>(initialOpsFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<TTarsActionLog | null>(null);
  const [timeline, setTimeline] = useState<TimelineTarget | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const optionsQuery = useTarsOperationLogOptionsQuery();
  const logsQuery = useTarsOperationLogsQuery(toQuery(applied, page, pageSize));

  useEffect(() => {
    if (optionsQuery.error != null) {
      showToast({ message: localize('com_ui_tars_ops_options_failed'), status: 'error' });
    }
  }, [optionsQuery.error, showToast, localize]);

  useEffect(() => {
    if (logsQuery.error != null) {
      showToast({ message: localize('com_ui_tars_ops_query_failed'), status: 'error' });
    }
  }, [logsQuery.error, showToast, localize]);

  const modules = useMemo(() => optionsQuery.data?.modules ?? [], [optionsQuery.data]);
  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;
  const summary = logsQuery.data?.summary ?? EMPTY_SUMMARY;

  const runSearch = () => {
    setApplied(filters);
    setPage(1);
  };

  /** A summary card is a shortcut for "show me only this verb", applied at once. */
  const toggleAction = (action: string) => {
    const next = applied.actionTypes.includes(action)
      ? applied.actionTypes.filter((value) => value !== action)
      : [...applied.actionTypes, action];
    const updated = { ...applied, actionTypes: next };
    setFilters(updated);
    setApplied(updated);
    setPage(1);
  };

  const exportWindow = useMemo(
    () => ({ start_date: applied.start, end_date: applied.end }),
    [applied.start, applied.end],
  );

  /**
   * Exports the whole filtered set rather than the visible page, in one extra
   * request. The route caps a page at `EXPORT_LIMIT`, so a larger result is
   * truncated and the operator is told rather than handed a silently short file.
   */
  const exportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await dataService.getTarsOperationLogs(
        toQuery(applied, 1, Math.min(total, EXPORT_LIMIT)),
      );
      const headers = [
        localize('com_ui_tars_ops_col_time'),
        localize('com_ui_tars_audit_col_user'),
        localize('com_ui_tars_ops_detail_email'),
        localize('com_ui_tars_ops_col_action'),
        localize('com_ui_tars_ops_col_module'),
        localize('com_ui_tars_ops_col_description'),
        localize('com_ui_tars_ops_detail_target_type'),
        localize('com_ui_tars_ops_detail_target_name'),
        localize('com_ui_tars_ops_col_status'),
        localize('com_ui_tars_audit_col_ip'),
        localize('com_ui_tars_ops_detail_api_endpoint'),
        localize('com_ui_tars_ops_detail_trace_id'),
      ];
      const rows = result.logs.map((log) => {
        const config = actionConfig(log.action_type);
        return [
          formatDateTime(log.created_at, i18n.language),
          log.username ?? '',
          log.user_email ?? '',
          config != null ? localize(config.labelKey) : (log.action_type ?? ''),
          moduleLabel(log.module, modules),
          log.description ?? '',
          log.target_type ?? '',
          log.target_name ?? '',
          log.status ?? '',
          log.ip_address ?? '',
          log.api_endpoint ?? '',
          log.trace_id ?? '',
        ];
      });
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadBlob(toCsvBlob(headers, rows), `SystemAuditReport_${stamp}.csv`);

      if (total > EXPORT_LIMIT) {
        showToast({
          message: localize('com_ui_tars_ops_export_capped', { 0: String(EXPORT_LIMIT) }),
          status: 'warning',
        });
      }
    } catch {
      showToast({ message: localize('com_ui_tars_ops_export_failed'), status: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [applied, total, modules, localize, i18n.language, showToast]);

  return (
    <div className="space-y-4">
      <Filters
        filters={filters}
        onChange={setFilters}
        onSubmit={runSearch}
        isLoading={logsQuery.isFetching}
        options={optionsQuery.data}
        optionsLoading={optionsQuery.isFetching}
      />

      <Summary summary={summary} selected={applied.actionTypes} onToggle={toggleAction} />

      <OperationsTable
        logs={logs}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={logsQuery.isFetching}
        isExporting={isExporting}
        modules={modules}
        locale={i18n.language}
        onSelectLog={setDetail}
        onSelectUser={setTimeline}
        onExport={() => void exportCsv()}
      />

      <DetailDialog
        log={detail}
        modules={modules}
        locale={i18n.language}
        onClose={() => setDetail(null)}
      />

      <TimelineDialog
        target={timeline}
        window={exportWindow}
        modules={modules}
        locale={i18n.language}
        onClose={() => setTimeline(null)}
        onSelectLog={(log) => {
          setTimeline(null);
          setDetail(log);
        }}
      />
    </div>
  );
}
