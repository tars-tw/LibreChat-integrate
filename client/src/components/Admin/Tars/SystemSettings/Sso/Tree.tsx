import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Search, User } from 'lucide-react';
import { Input, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsSsoConfig, TTarsLdapTreeNode } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/** pwc_tars marks leaf people with a `user`-ish type; everything else is a container. */
const isUserNode = (node: TTarsLdapTreeNode): boolean =>
  (node.type ?? '').toLowerCase().includes('user') || !node.children?.length;

const matches = (node: TTarsLdapTreeNode, query: string): boolean => {
  if (!query) {
    return true;
  }
  if (node.label.toLowerCase().includes(query) || node.key.toLowerCase().includes(query)) {
    return true;
  }
  return (node.children ?? []).some((child) => matches(child, query));
};

function TreeNode({
  node,
  depth,
  query,
  selected,
  onToggle,
}: {
  node: TTarsLdapTreeNode;
  depth: number;
  query: string;
  selected: Set<string>;
  onToggle: (username: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const children = node.children ?? [];
  const isUser = isUserNode(node);

  if (!matches(node, query)) {
    return null;
  }

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div className="flex items-center gap-1 py-0.5 text-sm">
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={node.label}
            onClick={() => setOpen((prev) => !prev)}
            className="rounded p-0.5 text-text-secondary hover:text-text-primary"
          >
            {open ? <ChevronDown className="icon-xs" /> : <ChevronRight className="icon-xs" />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {isUser ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selected.has(node.label)}
              onChange={() => onToggle(node.label)}
            />
            <User className="icon-xs text-text-secondary" aria-hidden="true" />
            <span className="text-text-primary">{node.label}</span>
          </label>
        ) : (
          <span className="flex items-center gap-2 text-text-primary">
            <Folder className="icon-xs text-text-secondary" aria-hidden="true" />
            {node.label}
          </span>
        )}
      </div>
      {open &&
        children.map((child) => (
          <TreeNode
            key={child.key}
            node={child}
            depth={depth + 1}
            query={query}
            selected={selected}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

/**
 * Directory browser for picking whitelist members. Selection is returned to the
 * caller, which owns the whitelist string pwc_tars actually stores.
 */
export default function LdapTreeModal({
  config,
  nodes,
  isLoading,
  initialSelection,
  onConfirm,
  onOpenChange,
}: {
  config: TTarsSsoConfig;
  nodes: TTarsLdapTreeNode[];
  isLoading: boolean;
  initialSelection: string[];
  onConfirm: (usernames: string[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));

  const query = useMemo(() => search.trim().toLowerCase(), [search]);

  const toggle = (username: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={`${config.ldap_name || config.ldap_server_address} — ${localize('com_ui_tars_sso_tree')}`}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-3">
            <div className="relative">
              <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={localize('com_ui_tars_sso_tree_search')}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_tars_sso_tree_selected', { count: selected.size })}
            </p>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border-light p-2">
              {isLoading && (
                <div className="flex h-32 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {!isLoading && nodes.length === 0 && (
                <p className="py-8 text-center text-sm text-text-secondary">
                  {localize('com_ui_tars_sso_tree_empty')}
                </p>
              )}
              {!isLoading &&
                nodes.map((node) => (
                  <TreeNode
                    key={node.key}
                    node={node}
                    depth={0}
                    query={query}
                    selected={selected}
                    onToggle={toggle}
                  />
                ))}
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={() => onConfirm([...selected])} disabled={isLoading}>
            {localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
