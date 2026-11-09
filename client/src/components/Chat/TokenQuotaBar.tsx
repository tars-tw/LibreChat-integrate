import { memo, useEffect, useRef } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useIsSubmitting } from '@librechat/chat/react';
import type { TTarsMyTokenQuota } from 'librechat-data-provider';
import { useTarsMyTokenQuotasQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const PROVIDER_META: Record<string, { label: string }> = {
  openai: { label: 'OpenAI' },
  gemini: { label: 'Gemini' },
  anthropic: { label: 'Anthropic' },
};

const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Same rule as pwc_tars' `resolve_provider`, so the bar agrees with what is metered. */
const resolveProvider = (model: string | null | undefined): string | null => {
  const name = model?.toLowerCase();
  if (!name) {
    return null;
  }
  if (name.includes('gemini')) {
    return 'gemini';
  }
  if (name.includes('gpt') || name.includes('openai')) {
    return 'openai';
  }
  if (name.includes('claude') || name.includes('anthropic')) {
    return 'anthropic';
  }
  return null;
};

const sharePct = (quota: TTarsMyTokenQuota): number | null =>
  quota.unlimited || quota.limit == null || quota.limit <= 0
    ? null
    : Math.min(Math.round((quota.used / quota.limit) * 100), 100);

/**
 * The header's token usage bar for the provider of the model currently selected.
 * Models outside OpenAI / Gemini / Anthropic are not metered, so nothing renders.
 */
function TokenQuotaBar() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { conversation } = useChatContext();
  const isSubmitting = useIsSubmitting(0);
  const { data: quotas = [] } = useTarsMyTokenQuotasQuery();

  /** A finished reply has just spent tokens; pull the new figure rather than wait for the poll. */
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (wasSubmitting.current && !isSubmitting) {
      queryClient.invalidateQueries([QueryKeys.tarsMyTokenQuotas]);
    }
    wasSubmitting.current = isSubmitting === true;
  }, [isSubmitting, queryClient]);

  const provider = resolveProvider(conversation?.model);
  const quota = provider == null ? undefined : quotas.find((item) => item.provider === provider);

  if (provider == null || quota == null) {
    return null;
  }

  const meta = PROVIDER_META[provider];
  const pct = sharePct(quota);
  const unlimited = localize('com_ui_tars_quota_unlimited');
  const isExceeded =
    !quota.unlimited && quota.limit != null && quota.limit > 0 && quota.used >= quota.limit;

  const summary =
    pct == null
      ? `${compact.format(quota.used)} / ∞`
      : `${compact.format(quota.used)} / ${compact.format(quota.limit ?? 0)}`;

  return (
    <TooltipAnchor
      description={`${meta.label} · ${pct == null ? unlimited : `${localize('com_ui_used')} ${pct}%`}`}
      render={
        <div
          data-testid="token-quota-bar"
          className="border-border-light bg-surface-primary text-text-secondary hover:bg-surface-active-alt flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium shadow-sm"
        >
          <div className="bg-surface-secondary h-1.5 w-20 shrink-0 overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isExceeded ? 'bg-text-tertiary' : 'bg-accent-primary',
              )}
              style={{ width: pct == null ? '100%' : `${pct}%` }}
            />
          </div>

          <span className="shrink-0 tabular-nums">{summary}</span>
        </div>
      }
    />
  );
}

export default memo(TokenQuotaBar);
