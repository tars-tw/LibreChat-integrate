import { useState, memo, useRef } from 'react';
import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import {
  Archive,
  CircleHelp,
  FileText,
  Keyboard,
  LifeBuoy,
  LogOut,
  Scale,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { ArchivedChatsModal } from '~/components/Nav/SettingsTabs/General/ArchivedChatsModal';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import AdminMenu, { SubmenuGroup } from './Tars/AdminMenu';
import { useAuthContext } from '~/hooks/AuthContext';
import { getHelpAndFaqURL } from '~/utils';
import { useLocalize } from '~/hooks';
import Settings from './Settings';
import store from '~/store';

function HelpSubmenu({
  helpAndFaqURL,
  termsOfServiceURL,
  privacyPolicyURL,
  onShowShortcuts,
}: {
  helpAndFaqURL?: string;
  termsOfServiceURL?: string;
  privacyPolicyURL?: string;
  onShowShortcuts: () => void;
}) {
  const localize = useLocalize();
  const lang = useRecoilValue(store.lang);
  const helpURL = getHelpAndFaqURL(lang, helpAndFaqURL);
  const hasTos = !!termsOfServiceURL;
  const hasPrivacy = !!privacyPolicyURL;
  const showLegalDivider = hasTos || hasPrivacy;

  return (
    <SubmenuGroup icon={CircleHelp} label={localize('com_nav_help')}>
      <Menu.MenuItem
        onClick={() => window.open(helpURL, '_blank', 'noopener,noreferrer')}
        className="select-item text-sm"
      >
        <LifeBuoy className="icon-md" aria-hidden="true" />
        {localize('com_nav_help_faq')}
      </Menu.MenuItem>
      <Menu.MenuItem onClick={onShowShortcuts} className="select-item text-sm">
        <Keyboard className="icon-md" aria-hidden="true" />
        {localize('com_shortcut_keyboard_shortcuts')}
      </Menu.MenuItem>
      {showLegalDivider && <DropdownMenuSeparator />}
      {hasTos && (
        <Menu.MenuItem
          onClick={() => window.open(termsOfServiceURL, '_blank', 'noopener,noreferrer')}
          className="select-item text-sm"
        >
          <Scale className="icon-md" aria-hidden="true" />
          {localize('com_ui_terms_of_service')}
        </Menu.MenuItem>
      )}
      {hasPrivacy && (
        <Menu.MenuItem
          onClick={() => window.open(privacyPolicyURL, '_blank', 'noopener,noreferrer')}
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
  const { user, isAuthenticated, logout } = useAuthContext();
  const navigate = useNavigate();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const [showSettings, setShowSettings] = useState(false);
  const setShowShortcutsDialog = useSetRecoilState(store.showShortcutsDialog);
  const [showArchived, setShowArchived] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const isTarsAdmin = user?.role === SystemRoles.ADMIN && user?.provider === 'tars';

  return (
    <Menu.MenuProvider placement={collapsed ? 'right-end' : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className={
          collapsed
            ? 'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
            : 'mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt'
        }
      >
        <div
          className={collapsed ? 'size-7 flex-shrink-0' : '-ml-0.9 -mt-0.8 h-8 w-8 flex-shrink-0'}
        >
          <div className="relative flex">
            <Avatar user={user} size={collapsed ? 28 : 32} />
          </div>
        </div>
        {!collapsed && (
          <div
            className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-primary"
            style={{ marginTop: '0', marginLeft: '0' }}
          >
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: collapsed ? 'left bottom' : 'bottom',
          translate: collapsed ? '4px 0' : '0 -4px',
        }}
      >
        <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <HelpSubmenu
          helpAndFaqURL={startupConfig?.helpAndFaqURL}
          termsOfServiceURL={startupConfig?.interface?.termsOfService?.externalUrl}
          privacyPolicyURL={startupConfig?.interface?.privacyPolicy?.externalUrl}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
        />
        <Menu.MenuItem onClick={() => setShowArchived(true)} className="select-item text-sm">
          <Archive className="icon-md" aria-hidden="true" />
          {localize('com_nav_archived_chats')}
        </Menu.MenuItem>
        {isTarsAdmin && <AdminMenu />}
        {isTarsAdmin && (
          <Menu.MenuItem onClick={() => navigate('/mcp-settings')} className="select-item text-sm">
            <Wrench className="icon-md" aria-hidden="true" />
            {localize('com_ui_tars_mcp_settings')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem
          onClick={() => setShowSettings(true)}
          className="select-item text-sm"
          data-testid="nav-settings"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
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
      {showSettings && <Settings open={showSettings} onOpenChange={setShowSettings} />}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
