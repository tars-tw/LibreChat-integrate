import type { ModelSelectorProps } from '~/common';
import { ModelSelectorChatProvider } from './Endpoints/ModelSelectorChatContext';
import { ModelSelectorProvider } from './Endpoints/ModelSelectorContext';
import ModelSelector from './Endpoints/ModelSelector';
import ParametersButton from './Parameters/Button';
import DomainSelector from './Tars/DomainSelector';

/**
 * Chat-header picker cluster: the specialized brain (專用腦) on the left, the model in the
 * middle, its parameters on the right. Both pickers share one `ModelSelectorProvider` —
 * the brain picker hosts the agents submenu, so it needs the same endpoint data the model
 * picker resolves.
 */
export default function Selectors({ startupConfig }: ModelSelectorProps) {
  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <DomainSelector />
        <ModelSelector startupConfig={startupConfig} />
        <ParametersButton startupConfig={startupConfig} />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
