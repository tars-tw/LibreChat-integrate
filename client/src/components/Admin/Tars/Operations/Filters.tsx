import { useMemo, useState } from 'react';
import { Button, Input, Label, Spinner } from '@librechat/client';
import { ChevronDown, ChevronUp, RotateCcw, Search } from 'lucide-react';
import type { TTarsActionLogOptionsResponse } from 'librechat-data-provider';
import type { PickerOption } from '../Audit/Picker';
import { ACTION_ORDER, actionConfig, defaultWindow } from './helpers';
import { pickerLabel } from '../Audit/Picker';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

export interface OpsFilterState {
  start: string;
  end: string;
  userIds: string[];
  actionTypes: string[];
  modules: string[];
  keyword: string;
}

export const initialOpsFilters = (): OpsFilterState => {
  const { start, end } = defaultWindow();
  return { start, end, userIds: [], actionTypes: [], modules: [], keyword: '' };
};

/**
 * The operation-audit filter bar. Collapses to a one-line summary once a search
 * has run, so the trail below gets the screen back.
 */
export default function Filters({
  filters,
  onChange,
  onSubmit,
  isLoading,
  options,
  optionsLoading,
}: {
  filters: OpsFilterState;
  onChange: (next: OpsFilterState) => void;
  onSubmit: () => void;
  isLoading: boolean;
  options: TTarsActionLogOptionsResponse | undefined;
  optionsLoading: boolean;
}) {
  const localize = useLocalize();
  const [collapsed, setCollapsed] = useState(false);

  const set = <K extends keyof OpsFilterState>(key: K, value: OpsFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const userOptions: PickerOption[] = useMemo(
    () =>
      (options?.users ?? []).map((user) => ({
        value: user.user_id,
        label: pickerLabel(user.username, user.user_email, user.user_id),
      })),
    [options],
  );

  const moduleOptions: PickerOption[] = useMemo(
    () => (options?.modules ?? []).map((module) => ({ value: module.value, label: module.title })),
    [options],
  );

  /**
   * The full verb list, not only the verbs already present in the trail —
   * "nothing was deleted this month" is itself a finding worth being able to ask
   * for, and pwc_tars only reports the verbs it has rows for.
   */
  const actionOptions: PickerOption[] = useMemo(
    () =>
      ACTION_ORDER.map((action) => {
        const config = actionConfig(action);
        return { value: action, label: config != null ? localize(config.labelKey) : action };
      }),
    [localize],
  );

  const rangeInvalid = filters.start !== '' && filters.end !== '' && filters.start > filters.end;

  const summary = useMemo(() => {
    const parts = [`${filters.start.replace('T', ' ')} ~ ${filters.end.replace('T', ' ')}`];
    const count = (n: number) => localize('com_ui_tars_audit_selected_count', { 0: String(n) });
    if (filters.userIds.length > 0) {
      parts.push(`${localize('com_ui_tars_audit_col_user')} ${count(filters.userIds.length)}`);
    }
    if (filters.actionTypes.length > 0) {
      parts.push(`${localize('com_ui_tars_ops_col_action')} ${count(filters.actionTypes.length)}`);
    }
    if (filters.modules.length > 0) {
      parts.push(`${localize('com_ui_tars_ops_col_module')} ${count(filters.modules.length)}`);
    }
    if (filters.keyword.trim() !== '') {
      parts.push(`"${filters.keyword.trim()}"`);
    }
    return parts.join(' · ');
  }, [filters, localize]);

  if (collapsed) {
    return (
      <section className="rounded-xl border border-border-light">
        <header className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="min-w-0 truncate text-sm text-text-secondary" title={summary}>
            <span className="mr-2 font-medium text-text-primary">
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
    <section className="rounded-xl border border-border-light">
      <header className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-2">
        <h2 className="text-sm font-medium text-text-primary">
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
        className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!rangeInvalid) {
            onSubmit();
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="tars-ops-start">{localize('com_ui_tars_audit_start_date')}</Label>
          <Input
            id="tars-ops-start"
            type="datetime-local"
            value={filters.start}
            onChange={(event) => set('start', event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tars-ops-end">{localize('com_ui_tars_audit_end_date')}</Label>
          <Input
            id="tars-ops-end"
            type="datetime-local"
            value={filters.end}
            onChange={(event) => set('end', event.target.value)}
          />
        </div>

        <Picker
          id="tars-ops-users"
          label={localize('com_ui_tars_audit_col_user')}
          options={userOptions}
          selected={filters.userIds}
          onChange={(values) => set('userIds', values)}
          placeholder={localize('com_ui_tars_audit_all_users')}
          disabled={optionsLoading}
        />

        <Picker
          id="tars-ops-actions"
          label={localize('com_ui_tars_ops_col_action')}
          options={actionOptions}
          selected={filters.actionTypes}
          onChange={(values) => set('actionTypes', values)}
          placeholder={localize('com_ui_tars_ops_all_actions')}
        />

        <div className="md:col-span-2">
          <Picker
            id="tars-ops-modules"
            label={localize('com_ui_tars_ops_col_module')}
            options={moduleOptions}
            selected={filters.modules}
            onChange={(values) => set('modules', values)}
            placeholder={localize('com_ui_tars_ops_all_modules')}
            disabled={optionsLoading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tars-ops-keyword">{localize('com_ui_tars_audit_keyword')}</Label>
          <Input
            id="tars-ops-keyword"
            value={filters.keyword}
            onChange={(event) => set('keyword', event.target.value)}
            placeholder={localize('com_ui_tars_ops_keyword_placeholder')}
          />
        </div>

        <div className="flex items-end justify-end gap-2 pb-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(initialOpsFilters())}
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

        {rangeInvalid && (
          <p className="text-xs text-red-500 md:col-span-2 xl:col-span-4">
            {localize('com_ui_tars_audit_date_range_invalid')}
          </p>
        )}
      </form>
    </section>
  );
}
