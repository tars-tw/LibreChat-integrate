import type { ErrorRendererProps } from './parts';
import { readObject, readString } from './parts';
import { useLocalize } from '~/hooks';

/**
 * A chat refused because the agent is bound to a 專用腦 the user cannot use. The payload names
 * the brain when pwc_tars knows it, so the reader learns whether it is their access, a disabled
 * brain or a deleted one, and whom to ask.
 */
export default function TarsDomainError({ json }: ErrorRendererProps) {
  const localize = useLocalize();
  const domain = readObject(json, 'domain');
  if (domain == null) {
    return localize('com_error_tars_agent_domain_forbidden');
  }
  const name = readString(domain, 'name');
  if (name == null) {
    return localize('com_error_tars_agent_domain_deleted');
  }
  return domain.is_active === false
    ? localize('com_error_tars_agent_domain_disabled', { 0: name })
    : localize('com_error_tars_agent_domain_no_access', { 0: name });
}
