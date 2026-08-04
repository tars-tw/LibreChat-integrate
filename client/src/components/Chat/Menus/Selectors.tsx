import type { ModelSelectorProps } from '~/common';
import { ModelSelectorChatProvider } from './Endpoints/ModelSelectorChatContext';
import { ModelSelectorProvider } from './Endpoints/ModelSelectorContext';
import ModelSelector from './Endpoints/ModelSelector';
import DomainSelector from './Tars/DomainSelector';

/**
 * Chat-header picker cluster: the specialized brain (專用腦) on the left, the model on
 * the right. Both share one `ModelSelectorProvider` — the brain picker hosts the agents
 * submenu, so it needs the same endpoint data the model picker resolves.
 */
export default function Selectors({ startupConfig }: ModelSelectorProps) {
  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <DomainSelector />
        <ModelSelector startupConfig={startupConfig} />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
