import { useMemo, useState } from 'react';
import { Download, RotateCcw, Search } from 'lucide-react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import type {
  TTarsTokenUserUsage,
  TTarsTokenReportRange,
  TTarsTokenPrepareData,
} from 'librechat-data-provider';
import {
  useTarsTokenQuotasQuery,
  useTarsTokenConfigsQuery,
  useTarsTokenReportMembersQuery,
  useTarsTokenReportOverviewQuery,
} from '~/data-provider';
import {
  groupCeilings,
  userCeilings,
  reportTotals,
  formatTokens,
  totalDailyUsage,
  defaultReportRange,
} from './helpers';
import Picker, { type PickerOption } from '../../Audit/Picker';
import { downloadTokenReportCsvs } from './export';
import UserDialog from './UserDialog';
import { useLocalize } from '~/hooks';
import Members from './Members';
import Groups from './Groups';
import Ranked from './Ranked';
import Trend from './Trend';

/** One headline number, matching the audit report's statistics tiles. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border-light p-4">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {hint != null && <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

interface Drilldown {
  groupId: string;
  groupName: string;
}

/**
 * The token usage report (Token 使用報表), read against the quota rules that
 * cap it. Filters on top, then the period totals, the daily trend, the group
 * table — which drills into its members — and the brain and model splits.
 */
export default function Report({ options }: { options: TTarsTokenPrepareData | undefined }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [range, setRange] = useState(defaultReportRange);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<TTarsTokenReportRange | null>(null);
  const [submittedGroups, setSubmittedGroups] = useState<string[]>([]);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [openUser, setOpenUser] = useState<TTarsTokenUserUsage | null>(null);
  const [exporting, setExporting] = useState(false);

  const overviewQuery = useTarsTokenReportOverviewQuery(submitted);
  const configsQuery = useTarsTokenConfigsQuery({});
  const quotasQuery = useTarsTokenQuotasQuery({});

  const membersQuery = useTarsTokenReportMembersQuery(
    submitted == null || drilldown == null
      ? null
      : { ...submitted, user_group_ids: [drilldown.groupId] },
  );

  const overview = overviewQuery.data;
  const rangeInvalid = range.start === '' || range.end === '' || range.start > range.end;

  /** The filter narrows the tables; the period totals stay whole-tenant. */
  const groupRows = useMemo(() => {
    const rows = overview?.group_overview ?? [];
    if (submittedGroups.length === 0) {
      return rows;
    }
    const wanted = new Set(submittedGroups);
    return rows.filter((row) => wanted.has(String(row.user_group_id ?? '')));
  }, [overview, submittedGroups]);

  const totals = useMemo(() => reportTotals(groupRows), [groupRows]);
  const daily = useMemo(() => totalDailyUsage(groupRows), [groupRows]);
  const groupLimits = useMemo(() => groupCeilings(configsQuery.data ?? []), [configsQuery.data]);
  const userLimits = useMemo(() => userCeilings(quotasQuery.data ?? []), [quotasQuery.data]);

  const groupOptions: PickerOption[] = useMemo(
    () => (options?.groups ?? []).map((group) => ({ value: group.id, label: group.name })),
    [options],
  );

  const runSearch = () => {
    setDrilldown(null);
    setSubmittedGroups(groupIds);
    setSubmitted({ start_date: range.start, end_date: range.end });
  };

  const handleExport = async () => {
    if (submitted == null) {
      return;
    }
    setExporting(true);
    try {
      await downloadTokenReportCsvs(submitted, localize);
    } catch {
      showToast({ message: localize('com_ui_tars_report_export_failed'), status: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-light">
        <header className="border-b border-border-light px-4 py-2">
          <h2 className="text-sm font-medium text-text-primary">
            {localize('com_ui_tars_audit_filters')}
          </h2>
        </header>

        <form
          className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rangeInvalid) {
              runSearch();
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tars-report-start">{localize('com_ui_tars_audit_start_date')}</Label>
            <Input
              id="tars-report-start"
              type="date"
              value={range.start}
              max={range.end === '' ? undefined : range.end}
              onChange={(event) => setRange((prev) => ({ ...prev, start: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tars-report-end">{localize('com_ui_tars_audit_end_date')}</Label>
            <Input
              id="tars-report-end"
              type="date"
              value={range.end}
              min={range.start === '' ? undefined : range.start}
              onChange={(event) => setRange((prev) => ({ ...prev, end: event.target.value }))}
            />
          </div>

          <Picker
            id="tars-report-groups"
            label={localize('com_ui_tars_quota_col_group')}
            options={groupOptions}
            selected={groupIds}
            onChange={setGroupIds}
            placeholder={localize('com_ui_tars_quota_all_groups')}
          />

          <div className="flex items-end justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRange(defaultReportRange());
                setGroupIds([]);
              }}
              aria-label={localize('com_ui_reset')}
              title={localize('com_ui_reset')}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitted == null || exporting}
              onClick={handleExport}
              aria-label={localize('com_ui_tars_report_export')}
              title={localize('com_ui_tars_report_export')}
            >
              {exporting ? (
                <Spinner className="size-4" />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
            </Button>
            <Button
              type="submit"
              variant="submit"
              disabled={overviewQuery.isFetching || rangeInvalid}
            >
              {overviewQuery.isFetching ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Search className="mr-2 size-4" aria-hidden />
              )}
              {localize('com_ui_tars_audit_search')}
            </Button>
          </div>

          {rangeInvalid && (
            <p className="text-xs text-red-500 md:col-span-2 xl:col-span-4">
              {localize('com_ui_tars_audit_date_range_invalid')}
            </p>
          )}
        </form>
      </section>

      {overviewQuery.isError && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {localize('com_ui_tars_report_failed')}
        </p>
      )}

      {submitted == null && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_audit_prompt')}
        </p>
      )}

      {submitted != null && overview != null && (
        <>
          <p className="text-sm text-text-secondary">
            {`${localize('com_ui_tars_audit_period')}: ${overview.date_range.start_date} ~ ${overview.date_range.end_date}`}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={localize('com_ui_tars_report_col_tokens')}
              value={formatTokens(totals.tokens)}
            />
            <Stat
              label={localize('com_ui_tars_report_col_logs')}
              value={formatTokens(totals.logs)}
            />
            <Stat
              label={localize('com_ui_tars_report_col_users')}
              value={formatTokens(totals.users)}
            />
            <Stat
              label={localize('com_ui_tars_report_avg_per_user')}
              value={formatTokens(
                totals.users === 0 ? 0 : Math.round(totals.tokens / totals.users),
              )}
            />
          </div>

          <Trend days={daily} title={localize('com_ui_tars_report_daily_usage')} />

          <Groups
            rows={groupRows}
            ceilings={groupLimits}
            selectedId={drilldown?.groupId ?? null}
            onSelect={(groupId, groupName) => setDrilldown({ groupId, groupName })}
          />

          {drilldown != null && (
            <Members
              groupName={drilldown.groupName}
              members={membersQuery.data ?? []}
              ceilings={userLimits}
              inherited={groupLimits.get(drilldown.groupId)}
              isLoading={membersQuery.isFetching}
              onSelect={setOpenUser}
              onClear={() => setDrilldown(null)}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Ranked
              title={localize('com_ui_tars_report_by_domain')}
              items={overview.domain_usage.map((domain) => ({
                key: String(domain.domain_id ?? domain.domain_name ?? ''),
                label: domain.domain_name ?? localize('com_ui_tars_report_unassigned'),
                value: domain.total_tokens,
              }))}
            />
            <Ranked
              title={localize('com_ui_tars_report_by_model')}
              items={overview.model_usage.map((model) => ({
                key: model.model_name,
                label: model.model_name,
                value: model.total_tokens,
                share: Math.round(model.usage_rate),
              }))}
            />
          </div>
        </>
      )}

      <UserDialog
        user={openUser}
        range={submitted ?? { start_date: range.start, end_date: range.end }}
        onClose={() => setOpenUser(null)}
      />
    </div>
  );
}
