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
  LayoutGrid,
  Library,
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

export type AdminMenuNode = {
  labelKey: TranslationKeys;
  icon: LucideIcon;
  path?: string;
  children?: AdminMenuNode[];
};

export const ADMIN_MENU: AdminMenuNode[] = [
  {
    labelKey: 'com_ui_tars_nav_data_knowledge',
    icon: Database,
    children: [
      {
        labelKey: 'com_ui_tars_nav_kb_mgmt',
        icon: Library,
        children: [
          { labelKey: 'com_ui_tars_nav_kb_list', icon: List, path: '/knowledge-bases' },
          { labelKey: 'com_ui_tars_nav_kb_schedule', icon: CalendarClock, path: '/kb-schedules' },
        ],
      },
      {
        labelKey: 'com_ui_tars_nav_datasource',
        icon: Boxes,
        children: [
          { labelKey: 'com_ui_tars_nav_app_db', icon: Server, path: '/data-sources/databases' },
          {
            labelKey: 'com_ui_tars_nav_doc_groups',
            icon: FolderOpen,
            path: '/data-sources/documents',
          },
          { labelKey: 'com_ui_tars_nav_websites', icon: Globe, path: '/data-sources/websites' },
        ],
      },
    ],
  },
  {
    labelKey: 'com_ui_tars_nav_app_system',
    icon: LayoutGrid,
    children: [
      {
        labelKey: 'com_ui_tars_nav_users_permissions',
        icon: Users,
        children: [
          { labelKey: 'com_ui_tars_nav_users', icon: User, path: '/admin/users' },
          { labelKey: 'com_ui_tars_nav_groups', icon: UsersRound, path: '/admin/groups' },
          { labelKey: 'com_ui_tars_nav_permissions', icon: KeyRound, path: '/admin/permissions' },
          { labelKey: 'com_ui_tars_nav_domains', icon: BrainCircuit, path: '/admin/domains' },
        ],
      },
      {
        labelKey: 'com_ui_tars_nav_system_mgmt',
        icon: Cog,
        children: [
          {
            labelKey: 'com_ui_tars_nav_system_settings',
            icon: Settings,
            path: '/admin/system-settings',
          },
          { labelKey: 'com_ui_tars_sys_config', icon: SlidersHorizontal, path: '/system-config' },
          { labelKey: 'com_ui_tars_nav_model_keys', icon: KeySquare, path: '/admin/model-keys' },
          {
            labelKey: 'com_ui_tars_nav_issues',
            icon: MessageSquareWarning,
            path: '/admin/issues',
          },
          { labelKey: 'com_ui_tars_nav_about', icon: Info, path: '/admin/about' },
        ],
      },
    ],
  },
  {
    labelKey: 'com_ui_tars_nav_audit',
    icon: ClipboardList,
    children: [
      {
        labelKey: 'com_ui_tars_nav_audit_messages',
        icon: MessageSquareText,
        path: '/audit/messages',
      },
      { labelKey: 'com_ui_tars_nav_audit_operations', icon: History, path: '/audit/operations' },
      { labelKey: 'com_ui_tars_nav_audit_tokens', icon: Coins, path: '/audit/tokens' },
      {
        labelKey: 'com_ui_tars_nav_audit_governance',
        icon: ShieldCheck,
        path: '/audit/governance',
      },
    ],
  },
];

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

function AdminMenuItem({ node }: { node: AdminMenuNode }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const label = localize(node.labelKey);
  const Icon = node.icon;

  if (node.children?.length) {
    return (
      <SubmenuGroup icon={Icon} label={label}>
        {node.children.map((child) => (
          <AdminMenuItem key={child.labelKey} node={child} />
        ))}
      </SubmenuGroup>
    );
  }

  return (
    <Menu.MenuItem onClick={() => navigate(node.path ?? '/c/new')} className="select-item text-sm">
      <Icon className="icon-md" aria-hidden="true" />
      {label}
    </Menu.MenuItem>
  );
}

/** Hierarchical pwc_tars administration menu rendered inside the account menu. */
export default function AdminMenu() {
  return (
    <>
      {ADMIN_MENU.map((node) => (
        <AdminMenuItem key={node.labelKey} node={node} />
      ))}
    </>
  );
}
