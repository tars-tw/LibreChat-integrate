import { useEffect, useMemo, useRef } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import type { TTarsMyTokenQuota } from 'librechat-data-provider';
import { useTarsMyTokenQuotasQuery } from '~/data-provider';

export const TOKEN_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
};

export const resolveTokenProvider = (model: string | null | undefined): string | null => {
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

export interface TokenQuotaGuard {
  provider: string | null;
  quota: TTarsMyTokenQuota | undefined;
  exceeded: boolean;
}

export default function useTokenQuotaGuard(model: string | null | undefined): TokenQuotaGuard {
  const { data: quotas = [] } = useTarsMyTokenQuotasQuery();

  return useMemo(() => {
    const provider = resolveTokenProvider(model);
    const quota = provider == null ? undefined : quotas.find((item) => item.provider === provider);
    const exceeded = quota?.quota_exceeded === true && quota.unlimited !== true;
    return { provider, quota, exceeded };
  }, [model, quotas]);
}

export function useRefreshQuotaAfterReply(isSubmitting: boolean): void {
  const queryClient = useQueryClient();
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (wasSubmitting.current && !isSubmitting) {
      queryClient.invalidateQueries([QueryKeys.tarsMyTokenQuotas]);
    }
    wasSubmitting.current = isSubmitting === true;
  }, [isSubmitting, queryClient]);
}
