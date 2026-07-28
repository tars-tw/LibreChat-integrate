import { Brain } from 'lucide-react';
import { useTarsDomain } from './domain';
import { useLocalize } from '~/hooks';

/**
 * Read-only badge showing which specialized brain (專用腦) the active conversation
 * is bound to. Picking a brain happens inside the model selector's "My Agents"
 * submenu (see `DomainItems`); this only reflects the current selection.
 * Renders nothing for non-tars users or when no domains are available.
 */
function DomainSelector() {
  const localize = useLocalize();
  const { domains, selectedName } = useTarsDomain();

  if (!domains.length || !selectedName) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label={localize('com_ui_tars_domain_active')}
      title={`${localize('com_ui_tars_domain_active')}: ${selectedName}`}
      className="my-1 flex h-9 max-w-56 flex-shrink-0 items-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary"
    >
      <Brain className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="truncate">{selectedName}</span>
    </div>
  );
}

export default DomainSelector;
