import { VisuallyHidden } from '@ariakit/react';
import { Brain, CheckCircle2 } from 'lucide-react';
import type { TTarsDomain } from 'librechat-data-provider';
import { CustomMenuItem as MenuItem } from '../Endpoints/CustomMenu';
import { useLocalize } from '~/hooks';

interface DomainMenuItemProps {
  domain: TTarsDomain;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

/**
 * One specialized brain (專用腦) row. Presentational on purpose — the caller owns the
 * `useTarsDomain` subscription so a long brain list doesn't mount one hook per row.
 */
export function DomainMenuItem({ domain, isSelected, onSelect }: DomainMenuItemProps) {
  const localize = useLocalize();

  return (
    <MenuItem
      onClick={() => onSelect(String(domain.id))}
      aria-selected={isSelected || undefined}
      className="group flex w-full cursor-pointer items-center justify-between rounded-lg px-2 text-sm"
    >
      <div className="flex w-full min-w-0 items-center gap-2 py-1">
        <Brain className="size-5 shrink-0 text-text-primary" aria-hidden="true" />
        <span className="truncate text-left">{domain.name}</span>
      </div>
      {isSelected && (
        <>
          <CheckCircle2 className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
          <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
        </>
      )}
    </MenuItem>
  );
}

export default DomainMenuItem;
