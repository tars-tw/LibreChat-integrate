import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AdminMenuNode } from '~/components/Nav/Tars/AdminMenu';
import {
  ADMIN_MENU_TREE,
  adminMenuLeafKeys,
  adminMenuNodeKeys,
} from '~/components/Nav/Tars/AdminMenu';
import { useLocalize } from '~/hooks';

/** labelKeys of every node with children, in tree order — the default (fully expanded) state. */
function branchLabelKeys(nodes: AdminMenuNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: AdminMenuNode[]) => {
    for (const item of items) {
      if (item.children?.length) {
        keys.push(item.labelKey);
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

function MenuNode({
  node,
  depth,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  node: AdminMenuNode;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  onToggleSelect: (keys: string[], checked: boolean) => void;
  onToggleExpand: (labelKey: string) => void;
}) {
  const localize = useLocalize();
  const label = localize(node.labelKey);
  const Icon = node.icon;
  const keys = useMemo(() => adminMenuNodeKeys(node), [node]);
  const checkedCount = keys.filter((key) => selected.has(key)).length;
  const allChecked = keys.length > 0 && checkedCount === keys.length;
  const partial = checkedCount > 0 && !allChecked;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.labelKey);

  return (
    <div>
      <div
        className={`group hover:bg-surface-hover flex items-center gap-1.5 rounded-md pr-2 ${
          allChecked ? 'bg-brand-primary-subtle/40' : ''
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.labelKey)}
            aria-expanded={isOpen}
            aria-label={isOpen ? localize('com_ui_collapse') : localize('com_ui_expand')}
            className="text-text-secondary hover:text-text-primary flex h-6 w-5 shrink-0 items-center justify-center"
          >
            {isOpen ? (
              <ChevronDown className="icon-sm" aria-hidden="true" />
            ) : (
              <ChevronRight className="icon-sm" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="h-6 w-5 shrink-0" aria-hidden="true" />
        )}

        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            className="border-border-xheavy text-brand-primary focus-visible:ring-text-primary h-4 w-4 shrink-0 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            checked={allChecked}
            ref={(input) => {
              if (input) {
                input.indeterminate = partial;
              }
            }}
            onChange={() => onToggleSelect(keys, !allChecked)}
          />
          {Icon && <Icon className="icon-sm text-text-secondary shrink-0" aria-hidden="true" />}
          <span className={`text-text-primary truncate ${depth === 0 ? 'font-medium' : ''}`}>
            {label}
          </span>
          {hasChildren && (
            <span
              className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs tabular-nums ${
                allChecked ? 'bg-brand-primary-subtle text-brand-primary' : 'text-text-secondary'
              }`}
            >
              {checkedCount}/{keys.length}
            </span>
          )}
        </label>
      </div>

      {hasChildren && isOpen && (
        <div className="border-border-light ml-[0.6rem] border-l pl-3">
          {node.children?.map((child) => (
            <MenuNode
              key={child.labelKey}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Checkbox tree over the LibreChat admin menu. Only leaves are stored; a branch
 * is a convenience toggle for everything beneath it and renders indeterminate
 * when its descendants are partly selected. Branches collapse independently so
 * a large menu stays scannable, and each branch's own row keeps showing its
 * selected/total count even while collapsed.
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
  const allBranchKeys = useMemo(() => branchLabelKeys(ADMIN_MENU_TREE), []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allBranchKeys));

  const allSelected = allKeys.length > 0 && allKeys.every((key) => selected.has(key));
  const isFullyExpanded = allBranchKeys.every((key) => expanded.has(key));

  const handleToggleSelect = (keys: string[], checked: boolean) => {
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

  const handleToggleExpand = (labelKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(labelKey)) {
        next.delete(labelKey);
      } else {
        next.add(labelKey);
      }
      return next;
    });
  };

  const toggleExpandAll = () => setExpanded(isFullyExpanded ? new Set() : new Set(allBranchKeys));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-text-primary text-sm font-medium">
            {localize('com_ui_tars_roles_menus')}
          </span>
          <span className="text-text-secondary text-xs">
            {localize('com_ui_tars_roles_menus_selected', { count: selected.size })}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={toggleExpandAll}
            className="text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
          >
            {isFullyExpanded
              ? localize('com_ui_tars_roles_menus_collapse_all')
              : localize('com_ui_tars_roles_menus_expand_all')}
          </button>
          <button
            type="button"
            onClick={() => onChange(allSelected ? new Set() : new Set(allKeys))}
            className="text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
          >
            {allSelected
              ? localize('com_ui_tars_roles_menus_clear')
              : localize('com_ui_tars_roles_menus_all')}
          </button>
        </div>
      </div>
      <div className="border-border-light max-h-80 overflow-y-auto rounded-lg border p-2">
        {ADMIN_MENU_TREE.map((node) => (
          <MenuNode
            key={node.labelKey}
            node={node}
            depth={0}
            selected={selected}
            expanded={expanded}
            onToggleSelect={handleToggleSelect}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
      <p className="text-text-secondary text-xs">{localize('com_ui_tars_roles_menus_hint')}</p>
    </div>
  );
}
