import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Search, User, Users } from 'lucide-react';
import { Input, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsSsoConfig, TTarsLdapTreeNode } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type LdapNodeKind = 'user' | 'group' | 'ou';

/**
 * pwc_tars always tags a node's kind at `data.type`. The children-length guess
 * only covers the (unexpected) case where that field is missing.
 */
const getNodeKind = (node: TTarsLdapTreeNode): LdapNodeKind => {
  const type = (node.data?.type ?? '').toLowerCase();
  if (type === 'user' || type === 'group' || type === 'ou') {
    return type;
  }
  return node.children?.length ? 'ou' : 'user';
};

export const matchesLdapTreeSearch = (node: TTarsLdapTreeNode, query: string): boolean => {
  if (!query) {
    return true;
  }
  if (node.label.toLowerCase().includes(query) || node.key.toLowerCase().includes(query)) {
    return true;
  }
  return (node.children ?? []).some((child) => matchesLdapTreeSearch(child, query));
};

const KIND_ICON: Record<LdapNodeKind, typeof User> = {
  user: User,
  group: Users,
  ou: Folder,
};

/**
 * Every user account (by sAMAccountName) under this node, including the node
 * itself when it is a user. Powers both the leaf checkbox and the
 * check-all/indeterminate state on group and OU checkboxes — pwc_tars lets an
 * admin whitelist an entire OU or group in one click rather than every member
 * individually.
 */
const collectUserAccounts = (node: TTarsLdapTreeNode): string[] => {
  if (getNodeKind(node) === 'user') {
    const account = node.data?.sAMAccountName;
    return account ? [account] : [];
  }
  return (node.children ?? []).flatMap(collectUserAccounts);
};

function NodeLabel({
  node,
  kind,
  selectable,
  selected,
  onToggle,
  accounts,
}: {
  node: TTarsLdapTreeNode;
  kind: LdapNodeKind;
  selectable: boolean;
  selected?: Set<string>;
  onToggle?: (accounts: string[], checked: boolean) => void;
  accounts: string[];
}) {
  const localize = useLocalize();
  const memberCount = kind === 'group' ? node.data?.member_count : null;
  const label = (
    <>
      {node.label}
      {memberCount != null && (
        <span className="ml-1 text-xs font-normal text-text-secondary">
          ({localize('com_ui_tars_sso_tree_group_members', { count: memberCount })})
        </span>
      )}
    </>
  );

  const Icon = KIND_ICON[kind];

  // Only the whitelist picker is selectable, and only accounts with a real
  // sAMAccountName can be whitelisted — an OU/group with none (unresolved
  // members, or nothing under it) gets no checkbox to toggle.
  if (selectable && accounts.length > 0) {
    const checkedCount = selected ? accounts.filter((account) => selected.has(account)).length : 0;
    const allChecked = checkedCount === accounts.length;
    const someChecked = checkedCount > 0 && !allChecked;
    return (
      <label className="flex cursor-pointer items-center gap-2 text-text-primary">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={allChecked}
          ref={(el) => {
            if (el) {
              el.indeterminate = someChecked;
            }
          }}
          onChange={() => onToggle?.(accounts, !allChecked)}
        />
        <Icon className="icon-xs text-text-secondary" aria-hidden="true" />
        <span>{label}</span>
      </label>
    );
  }

  return (
    <span className="flex items-center gap-2 text-text-primary">
      <Icon className="icon-xs text-text-secondary" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * One row of the directory tree. Shared by the whitelist picker (checkboxes on
 * user rows) and the read-only AD import preview (`selectable={false}`, no
 * `selected`/`onToggle` needed) so both stay a single recursive renderer.
 */
export function LdapTreeNode({
  node,
  depth,
  query,
  selectable = true,
  selected,
  onToggle,
}: {
  node: TTarsLdapTreeNode;
  depth: number;
  query: string;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (accounts: string[], checked: boolean) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const children = node.children ?? [];
  const kind = getNodeKind(node);
  const accounts = useMemo(() => collectUserAccounts(node), [node]);

  if (!matchesLdapTreeSearch(node, query)) {
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
        <NodeLabel
          node={node}
          kind={kind}
          selectable={selectable}
          selected={selected}
          onToggle={onToggle}
          accounts={accounts}
        />
      </div>
      {open &&
        children.map((child) => (
          <LdapTreeNode
            key={child.key}
            node={child}
            depth={depth + 1}
            query={query}
            selectable={selectable}
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

  // A group/OU checkbox toggles every account under it at once; a leaf user
  // checkbox calls this with its own single-account list. `selected` is keyed
  // by username rather than node key, so the same account showing up under
  // several OUs/groups (see `include_ou_users`) always stays in sync.
  const toggle = (accounts: string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      accounts.forEach((account) => {
        if (checked) {
          next.add(account);
        } else {
          next.delete(account);
        }
      });
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
            <p className="text-xs text-text-destructive">
              {localize('com_ui_tars_sso_tree_excluded_hint')}
            </p>
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
                  <LdapTreeNode
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
