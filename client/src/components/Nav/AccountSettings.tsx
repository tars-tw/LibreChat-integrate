import { useState, memo, useRef, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useSetRecoilState } from 'recoil';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import {
  Archive,
  CircleHelp,
  Files,
  Keyboard,
  LifeBuoy,
  LogOut,
  Scale,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { ArchivedChatsModal } from '~/components/Nav/SettingsTabs/General/ArchivedChatsModal';
import { filesDialogTriggerAtom, showFilesDialogAtom } from '~/store/filesDialog';
import useDirection, { inlineSide } from '~/hooks/Nav/useDirection';
import { useGetStartupConfig } from '~/data-provider';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import AdminMenu, { SubmenuGroup } from './Tars/AdminMenu';
import useSidebarState from '~/hooks/Nav/useSidebarState';
import { useAuthContext } from '~/hooks/AuthContext';
import { openInNewTab, policyUrls } from '~/utils';
import { settingsOpenAtom } from './Settings';
import { useLocalize } from '~/hooks';
import store from '~/store';

function HelpSubmenu({
  helpAndFaqURL,
  termsOfServiceURL,
  privacyPolicyURL,
  onShowShortcuts,
  onNavigate,
}: {
  helpAndFaqURL?: string;
  termsOfServiceURL?: string;
  privacyPolicyURL?: string;
  onShowShortcuts: () => void;
  onNavigate: () => void;
}) {
  const localize = useLocalize();
  const hasHelpFaq = !!helpAndFaqURL && helpAndFaqURL !== '/';
  const hasTos = !!termsOfServiceURL;
  const hasPrivacy = !!privacyPolicyURL;
  const showLegalDivider = (hasHelpFaq || true) && (hasTos || hasPrivacy);

  return (
    <SubmenuGroup icon={CircleHelp} label={localize('com_nav_help')}>
      {hasHelpFaq && (
        <Menu.MenuItem
          onClick={() => {
            onNavigate();
            openInNewTab(helpAndFaqURL);
          }}
          className="select-item text-sm"
        >
          <LifeBuoy className="icon-md" aria-hidden="true" />
          {localize('com_nav_help_faq')}
        </Menu.MenuItem>
      )}
      <Menu.MenuItem
        onClick={() => {
          onNavigate();
          onShowShortcuts();
        }}
        className="select-item text-sm"
      >
        <Keyboard className="icon-md" aria-hidden="true" />
        {localize('com_shortcut_keyboard_shortcuts')}
      </Menu.MenuItem>
      {showLegalDivider && <DropdownMenuSeparator />}
      {hasTos && (
        <Menu.MenuItem
          onClick={() => {
            onNavigate();
            openInNewTab(termsOfServiceURL);
          }}
          className="select-item text-sm"
        >
          <Scale className="icon-md" aria-hidden="true" />
          {localize('com_ui_terms_of_service')}
        </Menu.MenuItem>
      )}
      {hasPrivacy && (
        <Menu.MenuItem
          onClick={() => {
            onNavigate();
            openInNewTab(privacyPolicyURL);
          }}
          className="select-item text-sm"
        >
          <ShieldCheck className="icon-md" aria-hidden="true" />
          {localize('com_ui_privacy_policy')}
        </Menu.MenuItem>
      )}
    </SubmenuGroup>
  );
}

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const { data: startupConfig } = useGetStartupConfig();
  const { privacyPolicyUrl, termsOfServiceUrl } = policyUrls(startupConfig);
  const setShowSettings = useSetAtom(settingsOpenAtom);
  const setShowFiles = useSetAtom(showFilesDialogAtom);
  const setFilesDialogTrigger = useSetAtom(filesDialogTriggerAtom);
  const setShowShortcutsDialog = useSetRecoilState(store.showShortcutsDialog);
  const [showArchived, setShowArchived] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);
  /** The collapsed rail opens the menu beside it, toward the content. */
  const railSide = inlineSide(useDirection(), 'end');
  const isTarsAdmin = user?.role === SystemRoles.ADMIN && user?.provider === 'tars';
  const { expanded: sidebarExpanded } = useSidebarState();
  const { setSidebarOpen } = useSidebarToggle();
  const collapseSidebarIfExpanded = useCallback(() => {
    if (sidebarExpanded) {
      setSidebarOpen(false);
    }
  }, [sidebarExpanded, setSidebarOpen]);

  return (
    <Menu.MenuProvider placement={collapsed ? `${railSide}-end` : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={
          collapsed
            ? 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-9 w-9 items-center justify-center rounded-lg transition-colors'
            : 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out'
        }
      >
        <div className={collapsed ? 'size-7 shrink-0' : 'h-8 w-8 shrink-0'}>
          <div className="relative flex">
            <Avatar user={user} size={collapsed ? 28 : 32} />
          </div>
        </div>
        {!collapsed && (
          <div className="text-text-primary grow overflow-hidden text-start text-ellipsis whitespace-nowrap">
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="popover-ui z-[125] w-[min(19.0625rem,90vw)] md:w-[min(15.25rem,90vw)]"
        style={{
          transformOrigin: collapsed
            ? `${railSide === 'right' ? 'left' : 'right'} bottom`
            : 'bottom',
          translate: collapsed ? `${railSide === 'right' ? 4 : -4}px 0` : '0 -4px',
        }}
      >
        <div className="text-text-secondary ms-3 me-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <DropdownMenuSeparator />
        <HelpSubmenu
          helpAndFaqURL={startupConfig?.helpAndFaqURL}
          termsOfServiceURL={termsOfServiceUrl}
          privacyPolicyURL={privacyPolicyUrl}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
          onNavigate={collapseSidebarIfExpanded}
        />
        <Menu.MenuItem
          onClick={() => {
            collapseSidebarIfExpanded();
            setShowArchived(true);
          }}
          className="select-item text-sm"
        >
          <Archive className="icon-md" aria-hidden="true" />
          {localize('com_nav_archived_chats')}
        </Menu.MenuItem>

        <Menu.MenuItem
          onClick={() => {
            /** The menu is gone by the time the dialog captures focus, so the
             *  account button has to be named here or focus returns to the
             *  document body when the dialog closes. */
            setFilesDialogTrigger(accountSettingsButtonRef);
            setShowFiles(true);
          }}
          className="select-item text-sm"
          data-testid="nav-files"
        >
          <Files className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Menu.MenuItem>
        {isTarsAdmin && <AdminMenu onNavigate={collapseSidebarIfExpanded} />}
        {isTarsAdmin && (
          <Menu.MenuItem
            onClick={() => {
              collapseSidebarIfExpanded();
              navigate('/mcp-settings');
            }}
            className="select-item text-sm"
          >
            <Wrench className="icon-md" aria-hidden="true" />
            {localize('com_ui_tars_mcp_settings')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem
          onClick={() => {
            collapseSidebarIfExpanded();
            setShowSettings(true);
          }}
          className="select-item text-sm"
          data-testid="nav-settings"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        <DropdownMenuSeparator />
        <Menu.MenuItem
          onClick={() => {
            collapseSidebarIfExpanded();
            logout();
          }}
          className="select-item text-sm"
        >
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
      {showArchived && (
        <ArchivedChatsModal
          open={showArchived}
          onOpenChange={setShowArchived}
          triggerRef={accountSettingsButtonRef}
        />
      )}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
