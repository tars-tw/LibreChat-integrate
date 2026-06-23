import { useMemo, useEffect } from 'react';
import { ControlCombobox } from '@librechat/client';
import type { OptionWithIcon } from '~/common';
import type { TConversation, TTarsDomain } from 'librechat-data-provider';
import { useTarsDomainsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize, useNewConvo } from '~/hooks';

const DEFAULT_DOMAIN_NAME = 'general';

/** Resolve the default specialized brain — "General" by name, else the first one. */
const resolveDefaultDomain = (domains: TTarsDomain[]): TTarsDomain | undefined =>
  domains.find((domain) => domain.name.trim().toLowerCase() === DEFAULT_DOMAIN_NAME) ?? domains[0];

/** Model-identifying fields carried over so switching brain keeps the current model. */
const carryOverModelFields = (conversation: TConversation | null): Partial<TConversation> => {
  if (!conversation) {
    return {};
  }
  const { endpoint, endpointType, model, spec, iconURL, agent_id, assistant_id } = conversation;
  return { endpoint, endpointType, model, spec, iconURL, agent_id, assistant_id };
};

/**
 * Lets a pwc_tars user pick one of their accessible specialized brains (專用腦).
 * A conversation is bound to exactly one brain (mirrors pwc_tars), so switching
 * to a different brain starts a NEW conversation scoped to it. Switching while on
 * a blank, unsent conversation just rebinds it in place. The selection persists as
 * `domain_id`; the backend injects that domain's instructions on each message.
 * Defaults to the "General" brain — there is no empty option. Renders nothing
 * for non-tars users or when no domains are available.
 */
function DomainSelector() {
  const localize = useLocalize();
  const { conversation, setConversation, getMessages } = useChatContext();
  const { newConversation } = useNewConvo();
  const { data: domains = [] } = useTarsDomainsQuery();

  const items: OptionWithIcon[] = useMemo(
    () => domains.map((domain) => ({ label: domain.name, value: String(domain.id) })),
    [domains],
  );

  const defaultDomainId = useMemo(() => {
    const fallback = resolveDefaultDomain(domains);
    return fallback ? String(fallback.id) : undefined;
  }, [domains]);

  const domainId = conversation?.domain_id ?? null;

  useEffect(() => {
    if (!defaultDomainId || domainId) {
      return;
    }
    setConversation((prev) => (prev ? { ...prev, domain_id: defaultDomainId } : prev));
  }, [defaultDomainId, domainId, setConversation]);

  if (!domains.length) {
    return null;
  }

  const selectedValue = domainId ?? defaultDomainId ?? '';
  const displayValue = domains.find((domain) => String(domain.id) === selectedValue)?.name;

  const handleSelect = (value: string) => {
    if (value === selectedValue) {
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
  };

  return (
    <ControlCombobox
      isCollapsed={false}
      ariaLabel={localize('com_ui_tars_domain_select')}
      selectPlaceholder={localize('com_ui_tars_domain_select')}
      searchPlaceholder={localize('com_ui_tars_domain_search')}
      selectedValue={selectedValue}
      displayValue={displayValue}
      items={items}
      setValue={handleSelect}
      showCarat={true}
      containerClassName="w-56 flex-shrink-0 px-0"
    />
  );
}

export default DomainSelector;
