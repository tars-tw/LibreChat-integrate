import { useMemo, useState } from 'react';
import { TARS_AUDIT_NO_AGENT } from 'librechat-data-provider';
import { ChevronDown, ChevronUp, RotateCcw, Search } from 'lucide-react';
import { Button, Checkbox, Input, Label, Spinner } from '@librechat/client';
import type { TTarsAuditOptionsResponse } from 'librechat-data-provider';
import { defaultDateRange, distinctLabels } from './helpers';
import Picker, { type PickerOption } from './Picker';
import { useLocalize } from '~/hooks';

/** Everything the operator can narrow the report by. */
export interface FilterState {
  start: string;
  end: string;
  userIds: string[];
  agentIds: string[];
  knowledgeBaseIds: string[];
  keyword: string;
  feedbackOnly: boolean;
}

export const initialFilters = (): FilterState => {
  const { start, end } = defaultDateRange();
  return {
    start,
    end,
    userIds: [],
    agentIds: [],
    knowledgeBaseIds: [],
    keyword: '',
    feedbackOnly: false,
  };
};

/**
 * The audit filter bar. Collapses to a one-line summary so the tables below get
 * the screen back once a query has been run — auditing is mostly reading
 * results, not re-tuning filters.
 */
export default function Filters({
  filters,
  onChange,
  onSubmit,
  isLoading,
  options,
  optionsLoading,
  missingAgents = [],
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  onSubmit: () => void;
  isLoading: boolean;
  options: TTarsAuditOptionsResponse | undefined;
  optionsLoading: boolean;
  /** Agents a past result named that no longer exist, so their history can still be filtered. */
  missingAgents?: { id: string; label: string }[];
}) {
  const localize = useLocalize();
  const [collapsed, setCollapsed] = useState(false);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const userOptions: PickerOption[] = useMemo(
    () => (options?.users ?? []).map((user) => ({ value: user.id, label: user.username })),
    [options],
  );
  /** Chats run without a saved agent are auditable too, so they get an entry of their own. */
  const agentOptions: PickerOption[] = useMemo(() => {
    const live = (options?.agents ?? []).map((agent) => ({ id: agent.id, label: agent.name }));
    const known = new Set(live.map((agent) => agent.id));
    const agents = distinctLabels([
      ...live,
      ...missingAgents.filter((agent) => !known.has(agent.id)),
    ]);
    return [
      { value: TARS_AUDIT_NO_AGENT, label: localize('com_ui_tars_audit_no_agent') },
      ...agents.map((agent) => ({ value: agent.id, label: agent.label })),
    ];
  }, [options, missingAgents, localize]);
  const kbOptions: PickerOption[] = useMemo(
    () => (options?.knowledge_bases ?? []).map((kb) => ({ value: kb.id, label: kb.name })),
    [options],
  );

  const rangeInvalid = filters.start === '' || filters.end === '' || filters.start > filters.end;

  /** What the collapsed header shows, so the active filters stay visible. */
  const summary = useMemo(() => {
    const parts = [`${filters.start} ~ ${filters.end}`];
    if (filters.userIds.length > 0) {
      parts.push(
        `${localize('com_ui_tars_audit_col_user')} ${localize('com_ui_tars_audit_selected_count', {
          0: String(filters.userIds.length),
        })}`,
      );
    }
    if (filters.agentIds.length > 0) {
      parts.push(
        `${localize('com_ui_tars_audit_col_agent')} ${localize('com_ui_tars_audit_selected_count', {
          0: String(filters.agentIds.length),
        })}`,
      );
    }
    if (filters.knowledgeBaseIds.length > 0) {
      parts.push(
        `${localize('com_ui_tars_audit_col_kb')} ${localize('com_ui_tars_audit_selected_count', {
          0: String(filters.knowledgeBaseIds.length),
        })}`,
      );
    }
    if (filters.keyword.trim() !== '') {
      parts.push(`"${filters.keyword.trim()}"`);
    }
    if (filters.feedbackOnly) {
      parts.push(localize('com_ui_tars_audit_feedback_only'));
    }
    return parts.join(' · ');
  }, [filters, localize]);

  if (collapsed) {
    return (
      <section className="border-border-light shrink-0 rounded-xl border">
        <header className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="text-text-secondary min-w-0 truncate text-sm" title={summary}>
            <span className="text-text-primary mr-2 font-medium">
              {localize('com_ui_tars_audit_filters')}
            </span>
            {summary}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(false)}
            aria-label={localize('com_ui_expand')}
            title={localize('com_ui_expand')}
          >
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </header>
      </section>
    );
  }

  return (
    <section className="border-border-light shrink-0 rounded-xl border">
      <header className="border-border-light flex items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="text-text-primary text-sm font-medium">
          {localize('com_ui_tars_audit_filters')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(true)}
          aria-label={localize('com_ui_collapse')}
          title={localize('com_ui_collapse')}
        >
          <ChevronUp className="size-4" aria-hidden />
        </Button>
      </header>

      <form
        className="grid gap-x-4 gap-y-5 p-4 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!rangeInvalid) {
            onSubmit();
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="tars-audit-start">{localize('com_ui_tars_audit_start_date')}</Label>
          <Input
            id="tars-audit-start"
            type="date"
            value={filters.start}
            max={filters.end === '' ? undefined : filters.end}
            onChange={(event) => set('start', event.target.value)}
            className="[&::-webkit-calendar-picker-indicator]:ml-3.5"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tars-audit-end">{localize('com_ui_tars_audit_end_date')}</Label>
          <Input
            id="tars-audit-end"
            type="date"
            value={filters.end}
            min={filters.start === '' ? undefined : filters.start}
            onChange={(event) => set('end', event.target.value)}
          />
        </div>

        <Picker
          id="tars-audit-users"
          label={localize('com_ui_tars_audit_col_user')}
          options={userOptions}
          selected={filters.userIds}
          onChange={(values) => set('userIds', values)}
          placeholder={localize('com_ui_tars_audit_all_users')}
          disabled={optionsLoading}
        />

        <Picker
          id="tars-audit-agents"
          label={localize('com_ui_tars_audit_col_agent')}
          options={agentOptions}
          selected={filters.agentIds}
          onChange={(values) => set('agentIds', values)}
          placeholder={localize('com_ui_tars_audit_all_agents')}
          disabled={optionsLoading}
        />

        <div className="space-y-1.5">
          <Label htmlFor="tars-audit-keyword">{localize('com_ui_tars_audit_keyword')}</Label>
          <Input
            id="tars-audit-keyword"
            value={filters.keyword}
            onChange={(event) => set('keyword', event.target.value)}
            placeholder={localize('com_ui_tars_audit_keyword_placeholder')}
          />
        </div>

        <Picker
          id="tars-audit-kbs"
          label={localize('com_ui_tars_audit_col_kb')}
          options={kbOptions}
          selected={filters.knowledgeBaseIds}
          onChange={(values) => set('knowledgeBaseIds', values)}
          placeholder={localize('com_ui_tars_audit_all_kbs')}
          disabled={optionsLoading}
        />

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 md:col-span-2">
          <label className="text-text-primary h-theme-field flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              aria-label={localize('com_ui_tars_audit_feedback_only')}
              checked={filters.feedbackOnly}
              onCheckedChange={(checked) => set('feedbackOnly', checked === true)}
            />
            {localize('com_ui_tars_audit_feedback_only')}
          </label>
          <div className="h-theme-field flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onChange(initialFilters())}
              aria-label={localize('com_ui_reset')}
              title={localize('com_ui_reset')}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
            <Button type="submit" variant="submit" disabled={isLoading || rangeInvalid}>
              {isLoading ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Search className="mr-2 size-4" aria-hidden />
              )}
              {localize('com_ui_tars_audit_search')}
            </Button>
          </div>
        </div>

        {rangeInvalid && (
          <p className="text-xs text-red-500 md:col-span-2 xl:col-span-4">
            {localize('com_ui_tars_audit_date_range_invalid')}
          </p>
        )}
      </form>
    </section>
  );
}
