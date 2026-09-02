import { getConfigDefaults } from 'librechat-data-provider';
import type { TStartupConfig } from 'librechat-data-provider';
import { useTarsDomain } from '../Tars/domain';

const defaultInterface = getConfigDefaults().interface;

/**
 * Whether the header's model picker is offered at all. A specialized brain and an agent
 * both pin their own model, and an install may turn the picker off entirely — in either
 * case nothing in the picker cluster (the parameters button included) applies.
 */
export function useModelSelectorVisible(startupConfig: TStartupConfig | undefined): boolean {
  const { domains, isGeneralDomain, selectedAgentId } = useTarsDomain();

  if (domains.length > 0 && (!isGeneralDomain || selectedAgentId != null)) {
    return false;
  }

  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  return interfaceConfig.modelSelect !== false || modelSpecs.length > 0;
}
