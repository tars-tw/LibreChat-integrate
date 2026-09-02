import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import {
  getConfigDefaults,
  isParamEndpoint,
  isAgentsEndpoint,
  getEndpointField,
} from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import { useModelSelectorVisible } from '../Endpoints/visibility';
import { useGetEndpointsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import ParametersDialog from './Dialog';
import { useLocalize } from '~/hooks';

const defaultInterface = getConfigDefaults().interface;

/**
 * Opens the per-conversation 模型參數 dialog from the header, immediately right of the
 * model picker. Gated on the same conditions the side panel's parameters entry used,
 * plus the picker's own visibility — a pinned model has no parameters to offer.
 */
export default function ParametersButton({ startupConfig }: ModelSelectorProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const { conversation } = useChatContext();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const selectorVisible = useModelSelectorVisible(startupConfig);

  const endpoint = conversation?.endpoint ?? '';
  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint);
  const keyProvided = useMemo(() => {
    const userProvidesKey = endpointsConfig?.[endpoint]?.userProvide ?? false;
    return userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true;
  }, [endpoint, endpointsConfig, keyExpiry.expiresAt]);

  const interfaceConfig = startupConfig?.interface ?? defaultInterface;

  if (!selectorVisible || interfaceConfig.parameters !== true || !keyProvided) {
    return null;
  }

  if (isAgentsEndpoint(endpoint) || isParamEndpoint(endpoint, endpointType ?? '') !== true) {
    return null;
  }

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_model_parameters')}
        role="button"
        tabIndex={0}
        aria-label={localize('com_ui_model_parameters')}
        onClick={() => setOpen(true)}
        data-testid="header-parameters-button"
        className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-border-light bg-presentation text-text-primary transition-all ease-in-out hover:bg-surface-tertiary disabled:pointer-events-none disabled:opacity-50"
      >
        <SlidersHorizontal className="icon-sm" aria-hidden="true" />
      </TooltipAnchor>
      <ParametersDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
