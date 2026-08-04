import { useCallback, useEffect, useMemo } from 'react';
import type { TConversation, TTarsDomain } from 'librechat-data-provider';
import { useTarsDomainsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useNewConvo } from '~/hooks';

/**
 * pwc_tars reserves id 100 for the general brain (通用腦) in its seed data
 * (`sql/2_insert_values/sys_domain.sql`: 150+ is agent-specific, 201+ is custom),
 * so the id is the reliable identifier — admins rename the domain freely.
 */
const GENERAL_DOMAIN_ID = 100;
const GENERAL_DOMAIN_NAMES = new Set(['general', '通用腦']);

/** Resolve the default specialized brain — the general brain (通用腦), else the first one. */
const resolveDefaultDomain = (domains: TTarsDomain[]): TTarsDomain | undefined =>
  domains.find((domain) => domain.id === GENERAL_DOMAIN_ID) ??
  domains.find((domain) => GENERAL_DOMAIN_NAMES.has(domain.name.trim().toLowerCase())) ??
  domains[0];

/** Model-identifying fields carried over so switching brain keeps the current model. */
const carryOverModelFields = (conversation: TConversation | null): Partial<TConversation> => {
  if (!conversation) {
    return {};
  }
  const { endpoint, endpointType, model, spec, iconURL, agent_id, assistant_id } = conversation;
  return { endpoint, endpointType, model, spec, iconURL, agent_id, assistant_id };
};

/**
 * Read-only view of the brain bound to the active conversation. Kept separate from
 * `useTarsDomain` so display-only consumers (e.g. the landing headline) don't pull in
 * the conversation-mutating machinery behind `selectDomain`.
 */
export function useSelectedTarsDomain() {
  const { conversation } = useChatContext();
  const { data: domains = [] } = useTarsDomainsQuery();

  const defaultDomainId = useMemo(() => {
    const fallback = resolveDefaultDomain(domains);
    return fallback ? String(fallback.id) : undefined;
  }, [domains]);

  const domainId = conversation?.domain_id ?? null;
  const selectedId = domainId ?? defaultDomainId ?? '';
  const selectedName = useMemo(
    () => domains.find((domain) => String(domain.id) === selectedId)?.name,
    [domains, selectedId],
  );

  return { domains, domainId, defaultDomainId, selectedId, selectedName };
}

/**
 * Shared state for the pwc_tars specialized brain (專用腦) bound to the active
 * conversation. A conversation maps to exactly one brain (mirrors pwc_tars), so
 * switching to a different brain starts a NEW conversation scoped to it; switching
 * while on a blank, unsent conversation just rebinds it in place. The selection
 * persists as `domain_id` and the backend injects that domain's instructions on
 * each message. Falls back to the "General" brain — there is no empty option.
 */
export function useTarsDomain() {
  const { conversation, setConversation, getMessages } = useChatContext();
  const { newConversation } = useNewConvo();
  const { domains, domainId, defaultDomainId, selectedId, selectedName } = useSelectedTarsDomain();

  /** The general brain leads the list; pwc_tars returns the rest ordered by name. */
  const orderedDomains = useMemo(() => {
    const general = resolveDefaultDomain(domains);
    if (!general || domains[0] === general) {
      return domains;
    }
    return [general, ...domains.filter((domain) => domain !== general)];
  }, [domains]);

  useEffect(() => {
    if (!defaultDomainId || domainId) {
      return;
    }
    setConversation((prev) => (prev ? { ...prev, domain_id: defaultDomainId } : prev));
  }, [defaultDomainId, domainId, setConversation]);

  const selectDomain = useCallback(
    (value: string) => {
      if (value === (conversation?.domain_id ?? defaultDomainId ?? '')) {
        return;
      }
      const hasMessages = (getMessages()?.length ?? 0) > 0;
      if (!hasMessages) {
        setConversation((prev) => (prev ? { ...prev, domain_id: value } : prev));
        return;
      }
      newConversation({
        template: { ...carryOverModelFields(conversation), domain_id: value },
      });
    },
    [conversation, defaultDomainId, getMessages, newConversation, setConversation],
  );

  /** The model picker is only offered on the general brain — a specialized brain pins its own model. */
  const isGeneralDomain = Boolean(defaultDomainId) && selectedId === defaultDomainId;

  return {
    domains: orderedDomains,
    generalDomainId: defaultDomainId,
    selectedId,
    selectedName,
    selectDomain,
    isGeneralDomain,
  };
}
