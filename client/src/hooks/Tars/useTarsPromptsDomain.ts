import { useMemo } from 'react';
import type { TTarsDomain } from 'librechat-data-provider';
import useTarsPromptsDomainId from './useTarsPromptsDomainId';
import { useTarsDomainsQuery } from '~/data-provider';

const DEFAULT_DOMAIN_NAME = 'general';

const resolveDefaultDomain = (domains: TTarsDomain[]): TTarsDomain | undefined =>
  domains.find((domain) => domain.name.trim().toLowerCase() === DEFAULT_DOMAIN_NAME) ?? domains[0];

/**
 * The accessible 專用腦 whose prompts the composer offers: the chat's own (see
 * `useTarsPromptsDomainId`), else `general`, else the first one. `undefined`
 * when the user can reach no brain at all.
 */
export default function useTarsPromptsDomain(): TTarsDomain | undefined {
  const { data: domains = [] } = useTarsDomainsQuery();
  const domainId = useTarsPromptsDomainId();

  return useMemo(() => {
    const target = domainId ? String(domainId) : null;
    return (
      (target && domains.find((domain) => String(domain.id) === target)) ||
      resolveDefaultDomain(domains)
    );
  }, [domains, domainId]);
}
