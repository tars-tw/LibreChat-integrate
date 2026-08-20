import { useMemo, useState } from 'react';
import { KeyRound, Search, Wallet } from 'lucide-react';
import { Button, Input, Label, Spinner } from '@librechat/client';
import type { TTarsUsageProvider, TTarsUsageQuery } from 'librechat-data-provider';
import { MODEL_KEY_GROUPS, currentMonth, formatCurrency, formatTokens, percentOf } from './helpers';
import { useTarsProviderUsageQuery } from '~/data-provider';
import DailyCosts from './DailyCosts';
import { useLocalize } from '~/hooks';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary disabled:opacity-50';

const PROVIDERS = MODEL_KEY_GROUPS.filter((group) => group.usageProvider != null);

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

/**
 * Provider spend for one month. pwc_tars queries the provider's admin API live
 * with the price-query key from `sys_config`, so the numbers here are the
 * provider's own billing figures rather than anything counted locally.
 */
export default function Usage() {
  const localize = useLocalize();

  const [provider, setProvider] = useState<TTarsUsageProvider>('openai');
  const [month, setMonth] = useState(currentMonth());
  const [budget, setBudget] = useState('');
  const [submitted, setSubmitted] = useState<TTarsUsageQuery | null>(null);

  const usageQuery = useTarsProviderUsageQuery(submitted);
  const usage = usageQuery.data;
  const error = usageQuery.error as { response?: { data?: { error?: string } } } | null;

  const parsedBudget = Number(budget);
  const budgetInvalid = budget !== '' && (!Number.isFinite(parsedBudget) || parsedBudget < 0);

  const runSearch = () => {
    setSubmitted({
      provider,
      month,
      budget: budget === '' || budgetInvalid ? undefined : parsedBudget,
    });
  };

  const lineItems = useMemo(
    () => Object.entries(usage?.costs.by_line_item ?? {}).sort((a, b) => b[1] - a[1]),
    [usage],
  );
  const models = useMemo(
    () =>
      Object.entries(usage?.completions.by_model ?? {}).sort(
        (a, b) => b[1].input_tokens + b[1].output_tokens - (a[1].input_tokens + a[1].output_tokens),
      ),
    [usage],
  );

  const totalCost = usage?.costs.total ?? 0;
  const billing = usage?.billing;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-light">
        <header className="border-b border-border-light px-4 py-2">
          <h2 className="text-sm font-medium text-text-primary">
            {localize('com_ui_tars_usage_query')}
          </h2>
        </header>

        <div className="flex items-start gap-2 border-b border-border-light bg-surface-secondary px-4 py-2 text-xs text-text-secondary">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{localize('com_ui_tars_usage_admin_key_notice')}</p>
        </div>

        <form
          className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!budgetInvalid) {
              runSearch();
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tars-usage-provider">{localize('com_ui_tars_usage_provider')}</Label>
            <select
              id="tars-usage-provider"
              className={SELECT_CLASS}
              value={provider}
              onChange={(event) => setProvider(event.target.value as TTarsUsageProvider)}
            >
              {PROVIDERS.map((group) => (
                <option key={group.usageProvider} value={group.usageProvider}>
                  {group.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tars-usage-month">{localize('com_ui_tars_usage_month')}</Label>
            <Input
              id="tars-usage-month"
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tars-usage-budget">{localize('com_ui_tars_usage_budget')}</Label>
            <Input
              id="tars-usage-budget"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="100"
            />
          </div>

          <div className="flex items-end">
            <Button
              type="submit"
              variant="submit"
              className="w-full"
              disabled={usageQuery.isFetching || month === '' || budgetInvalid}
            >
              {usageQuery.isFetching ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Search className="mr-2 size-4" aria-hidden />
              )}
              {localize('com_ui_tars_audit_search')}
            </Button>
          </div>

          {budgetInvalid && (
            <p className="text-xs text-red-500 md:col-span-2 xl:col-span-4">
              {localize('com_ui_tars_usage_budget_invalid')}
            </p>
          )}
        </form>
      </section>

      {usageQuery.isError && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {error?.response?.data?.error ?? localize('com_ui_tars_usage_failed')}
        </p>
      )}

      {usage == null && !usageQuery.isFetching && !usageQuery.isError && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_usage_prompt')}
        </p>
      )}

      {usage != null && (
        <>
          <p className="text-sm text-text-secondary">
            {localize('com_ui_tars_audit_period')}
            {': '}
            {usage.period.start_date} ~ {usage.period.end_date}
          </p>

          {billing != null && (
            <section className="rounded-xl border border-border-light">
              <header className="flex items-center gap-2 border-b border-border-light px-4 py-2">
                <Wallet className="size-4 text-text-secondary" aria-hidden />
                <h2 className="text-sm font-medium text-text-primary">
                  {localize('com_ui_tars_usage_billing')}
                </h2>
              </header>
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <Stat
                  label={localize('com_ui_tars_usage_month_spend')}
                  value={formatCurrency(billing.usage_this_month?.total_cost ?? totalCost)}
                  hint={
                    billing.usage_this_month == null
                      ? undefined
                      : `${billing.usage_this_month.period.start} ~ ${billing.usage_this_month.period.end}`
                  }
                />
                <Stat
                  label={localize('com_ui_tars_usage_budget')}
                  value={billing.budget == null ? '—' : formatCurrency(billing.budget)}
                  hint={
                    billing.budget == null ? localize('com_ui_tars_usage_budget_hint') : undefined
                  }
                />
                <div
                  className={`rounded-xl border p-4 ${
                    (billing.remaining_balance ?? 0) < 0
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-border-light'
                  }`}
                >
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_usage_remaining')}
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold tabular-nums ${
                      (billing.remaining_balance ?? 0) < 0 ? 'text-red-500' : 'text-text-primary'
                    }`}
                  >
                    {billing.remaining_balance == null
                      ? '—'
                      : formatCurrency(billing.remaining_balance)}
                  </p>
                  {billing.remaining_balance != null && billing.budget != null && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                      <div
                        className={`h-full rounded-full ${
                          billing.remaining_balance < 0 ? 'bg-red-500' : 'bg-brand-primary'
                        }`}
                        style={{
                          width: `${Math.min(percentOf(totalCost, billing.budget), 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={localize('com_ui_tars_usage_total_cost')}
              value={formatCurrency(totalCost)}
            />
            <Stat
              label={localize('com_ui_tars_usage_input_tokens')}
              value={formatTokens(usage.completions.total_input_tokens)}
            />
            <Stat
              label={localize('com_ui_tars_usage_output_tokens')}
              value={formatTokens(usage.completions.total_output_tokens)}
            />
            <Stat
              label={localize('com_ui_tars_usage_requests')}
              value={formatTokens(usage.completions.total_requests)}
              hint={
                usage.completions.total_requests === 0
                  ? localize('com_ui_tars_usage_requests_hint')
                  : undefined
              }
            />
          </div>

          {lineItems.length > 0 && (
            <section className="rounded-xl border border-border-light">
              <header className="border-b border-border-light px-4 py-2">
                <h2 className="text-sm font-medium text-text-primary">
                  {localize('com_ui_tars_usage_by_category')}
                </h2>
              </header>
              <ul className="divide-y divide-border-light">
                {lineItems.map(([item, amount]) => (
                  <li key={item} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-text-primary">{item}</span>
                      <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                        {`${percentOf(amount, totalCost)}% · ${formatCurrency(amount)}`}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                      <div
                        className="h-full rounded-full bg-brand-primary"
                        style={{ width: `${percentOf(amount, totalCost)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {usage.daily_costs.length > 0 && <DailyCosts days={usage.daily_costs} />}

          <section className="rounded-xl border border-border-light">
            <header className="border-b border-border-light px-4 py-2">
              <h2 className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_usage_by_model')}
              </h2>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-secondary text-left text-text-secondary">
                  <tr>
                    <th className="w-[40%] px-3 py-2 font-medium">
                      {localize('com_ui_tars_usage_col_model')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_usage_input_tokens')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_usage_output_tokens')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {localize('com_ui_tars_usage_requests')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {models.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-text-secondary">
                        {localize('com_ui_tars_audit_no_data')}
                      </td>
                    </tr>
                  ) : (
                    models.map(([model, stat]) => (
                      <tr key={model} className="border-t border-border-light">
                        <td className="px-3 py-2">
                          <span className="block truncate font-mono text-xs text-text-primary">
                            {model}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {formatTokens(stat.input_tokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {formatTokens(stat.output_tokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {formatTokens(stat.requests)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
