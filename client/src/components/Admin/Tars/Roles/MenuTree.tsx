import { useMemo } from 'react';
import type { AdminMenuNode } from '~/components/Nav/Tars/AdminMenu';
import {
  ADMIN_MENU_TREE,
  adminMenuLeafKeys,
  adminMenuNodeKeys,
} from '~/components/Nav/Tars/AdminMenu';
import { useLocalize } from '~/hooks';

function MenuNode({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: AdminMenuNode;
  depth: number;
  selected: Set<string>;
  onToggle: (keys: string[], checked: boolean) => void;
}) {
  const localize = useLocalize();
  const label = localize(node.labelKey);
  const keys = useMemo(() => adminMenuNodeKeys(node), [node]);
  const checkedCount = keys.filter((key) => selected.has(key)).length;
  const allChecked = keys.length > 0 && checkedCount === keys.length;
  const partial = checkedCount > 0 && !allChecked;

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={allChecked}
          ref={(input) => {
            if (input) {
              input.indeterminate = partial;
            }
          }}
          onChange={() => onToggle(keys, !allChecked)}
        />
        <span className={depth === 0 ? 'font-medium text-text-primary' : 'text-text-primary'}>
          {label}
        </span>
        {node.children?.length != null && node.children.length > 0 && (
          <span className="text-xs text-text-secondary">
            {checkedCount}/{keys.length}
          </span>
        )}
      </label>
      {node.children?.map((child) => (
        <MenuNode
          key={child.labelKey}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

/**
 * Checkbox tree over the LibreChat admin menu. Only leaves are stored; a branch
 * is a convenience toggle for everything beneath it and renders indeterminate
 * when its descendants are partly selected.
 */
export default function MenuTree({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const localize = useLocalize();
  const allKeys = useMemo(() => adminMenuLeafKeys(), []);
  const allSelected = allKeys.every((key) => selected.has(key));

  const handleToggle = (keys: string[], checked: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">
          {localize('com_ui_tars_roles_menus')}
        </span>
        <button
          type="button"
          onClick={() => onChange(allSelected ? new Set() : new Set(allKeys))}
          className="text-xs text-text-secondary underline hover:text-text-primary"
        >
          {allSelected
            ? localize('com_ui_tars_roles_menus_clear')
            : localize('com_ui_tars_roles_menus_all')}
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border-light p-2">
        {ADMIN_MENU_TREE.map((node) => (
          <MenuNode
            key={node.labelKey}
            node={node}
            depth={0}
            selected={selected}
            onToggle={handleToggle}
          />
        ))}
      </div>
      <p className="text-xs text-text-secondary">{localize('com_ui_tars_roles_menus_hint')}</p>
    </div>
  );
}
