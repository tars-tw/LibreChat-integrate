import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Cog,
  Coins,
  Database,
  FolderOpen,
  Globe,
  History,
  Info,
  KeyRound,
  KeySquare,
  List,
  MessageSquareText,
  MessageSquareWarning,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useTarsAdminAccess } from '~/hooks';

/**
 * A node of the pwc_tars administration menu. `key` is the stable identifier a
 * pwc_tars role stores in `sys_role.librechat_menu_keys` — deliberately not the
 * route or the translation key, so renaming either never invalidates a saved
 * permission set. Only leaves carry a `key`; a branch is shown when any of its
 * descendants is permitted.
 */
export type AdminMenuNode = {
  labelKey: TranslationKeys;
  icon: LucideIcon;
  key?: string;
  path?: string;
  children?: AdminMenuNode[];
};

export const ADMIN_MENU: AdminMenuNode[] = [
  {
    labelKey: 'com_ui_tars_nav_data_knowledge',
    icon: Database,
    children: [
      {
        labelKey: 'com_ui_tars_nav_kb_list',
        icon: List,
        key: 'kb.list',
        path: '/knowledge-bases',
      },
      {
        labelKey: 'com_ui_tars_nav_kb_schedule',
        icon: CalendarClock,
        key: 'kb.schedules',
        path: '/kb-schedules',
      },
      {
        labelKey: 'com_ui_tars_nav_datasource',
        icon: Boxes,
        children: [
          {
            labelKey: 'com_ui_tars_nav_app_db',
            icon: Server,
            key: 'datasource.databases',
            path: '/data-sources/databases',
          },
          {
            labelKey: 'com_ui_tars_nav_doc_groups',
            icon: FolderOpen,
            key: 'datasource.documents',
            path: '/data-sources/documents',
          },
          {
            labelKey: 'com_ui_tars_nav_websites',
            icon: Globe,
            key: 'datasource.websites',
            path: '/data-sources/websites',
          },
        ],
      },
    ],
  },
  {
    labelKey: 'com_ui_tars_mcp_settings',
    icon: Wrench,
    key: 'admin.mcp_settings',
    path: '/mcp-settings',
  },
  {
    labelKey: 'com_ui_tars_nav_audit',
    icon: ClipboardList,
    children: [
      {
        labelKey: 'com_ui_tars_nav_audit_messages',
        icon: MessageSquareText,
        key: 'audit.messages',
        path: '/audit/messages',
      },
      {
        labelKey: 'com_ui_tars_nav_audit_operations',
        icon: History,
        key: 'audit.operations',
        path: '/audit/operations',
      },
      {
        labelKey: 'com_ui_tars_nav_audit_tokens',
        icon: Coins,
        key: 'audit.tokens',
        path: '/audit/tokens',
      },
      {
        labelKey: 'com_ui_tars_nav_audit_governance',
        icon: ShieldCheck,
        key: 'audit.governance',
        path: '/audit/governance',
      },
    ],
  },
  {
    labelKey: 'com_ui_tars_nav_users_permissions',
    icon: Users,
    children: [
      {
        labelKey: 'com_ui_tars_nav_users',
        icon: User,
        key: 'admin.users',
        path: '/admin/users',
      },
      {
        labelKey: 'com_ui_tars_nav_groups',
        icon: UsersRound,
        key: 'admin.groups',
        path: '/admin/groups',
      },
      {
        labelKey: 'com_ui_tars_nav_permissions',
        icon: KeyRound,
        key: 'admin.permissions',
        path: '/admin/permissions',
      },
      {
        labelKey: 'com_ui_tars_nav_domains',
        icon: BrainCircuit,
        key: 'admin.domains',
        path: '/admin/domains',
      },
    ],
  },
  {
    labelKey: 'com_ui_tars_nav_system_mgmt',
    icon: Cog,
    children: [
      {
        labelKey: 'com_ui_tars_nav_system_settings',
        icon: Settings,
        key: 'admin.system_settings',
        path: '/admin/system-settings',
      },
      {
        labelKey: 'com_ui_tars_sys_config',
        icon: SlidersHorizontal,
        key: 'admin.system_config',
        path: '/system-config',
      },
      {
        labelKey: 'com_ui_tars_nav_model_keys',
        icon: KeySquare,
        key: 'admin.model_keys',
        path: '/admin/model-keys',
      },
      {
        labelKey: 'com_ui_tars_nav_issues',
        icon: MessageSquareWarning,
        key: 'admin.issues',
        path: '/admin/issues',
      },
      {
        labelKey: 'com_ui_tars_nav_about',
        icon: Info,
        key: 'admin.about',
        path: '/admin/about',
      },
    ],
  },
];

/** Every permission-controlled admin entry, as one tree for the permission editor. */
export const ADMIN_MENU_TREE: AdminMenuNode[] = ADMIN_MENU;

/** Depth-first leaf keys of a menu tree — the values a role actually stores. */
export function adminMenuLeafKeys(nodes: AdminMenuNode[] = ADMIN_MENU_TREE): string[] {
  const keys: string[] = [];
  const walk = (items: AdminMenuNode[]) => {
    for (const item of items) {
      if (item.children?.length) {
        walk(item.children);
        continue;
      }
      if (item.key != null) {
        keys.push(item.key);
      }
    }
  };
  walk(nodes);
  return keys;
}

/** The leaf keys one node covers — a leaf covers only itself. */
export function adminMenuNodeKeys(node: AdminMenuNode): string[] {
  if (node.children?.length) {
    return adminMenuLeafKeys(node.children);
  }
  return node.key == null ? [] : [node.key];
}

/**
 * Prunes a menu tree down to the nodes a given key predicate grants: a leaf
 * survives only when `hasKey(node.key)` is true, and a branch survives only
 * when at least one descendant does.
 */
export function filterMenuTree(
  nodes: AdminMenuNode[],
  hasKey: (key?: string | null) => boolean,
): AdminMenuNode[] {
  const filtered: AdminMenuNode[] = [];
  for (const node of nodes) {
    if (node.children?.length) {
      const children = filterMenuTree(node.children, hasKey);
      if (children.length > 0) {
        filtered.push({ ...node, children });
      }
      continue;
    }
    if (hasKey(node.key)) {
      filtered.push(node);
    }
  }
  return filtered;
}

export function SubmenuGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Menu.MenuProvider placement="right-start">
      <Menu.MenuItem
        hideOnClick={false}
        render={
          <Menu.MenuButton className="select-item flex w-full cursor-pointer items-center gap-2 text-sm" />
        }
      >
        <Icon className="icon-md" aria-hidden="true" />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight className="h-4 w-4 text-text-secondary" aria-hidden="true" />
      </Menu.MenuItem>
      <Menu.Menu
        portal
        gutter={12}
        className="account-settings-popover popover-ui popover-from-left z-[126] w-[244px] rounded-lg"
      >
        {children}
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

function AdminMenuItem({ node, onNavigate }: { node: AdminMenuNode; onNavigate?: () => void }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const label = localize(node.labelKey);
  const Icon = node.icon;

  if (node.children?.length) {
    return (
      <SubmenuGroup icon={Icon} label={label}>
        {node.children.map((child) => (
          <AdminMenuItem key={child.labelKey} node={child} onNavigate={onNavigate} />
        ))}
      </SubmenuGroup>
    );
  }

  return (
    <Menu.MenuItem
      onClick={() => {
        onNavigate?.();
        navigate(node.path ?? '/c/new');
      }}
      className="select-item text-sm"
    >
      <Icon className="icon-md" aria-hidden="true" />
      {label}
    </Menu.MenuItem>
  );
}

/**
 * Hierarchical pwc_tars administration menu rendered inside the account menu.
 * A tars admin sees every entry; any other tars user sees only the branches
 * and leaves their role's granted menu keys cover.
 */
export default function AdminMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { isTarsAdmin, hasKey } = useTarsAdminAccess();
  const visibleMenu = isTarsAdmin ? ADMIN_MENU : filterMenuTree(ADMIN_MENU, hasKey);

  return (
    <>
      {visibleMenu.map((node) => (
        <AdminMenuItem key={node.labelKey} node={node} onNavigate={onNavigate} />
      ))}
    </>
  );
}
