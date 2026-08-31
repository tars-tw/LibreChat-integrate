import { useNavigate } from 'react-router-dom';
import { Wrench, ChevronRight } from 'lucide-react';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

/**
 * Entry card for the pwc_tars tool source inside the MCP panel — where users
 * naturally look for MCP configuration. It is the single entry point to
 * `/mcp-settings`, landing on the user's own catalog (toggles, credentials);
 * tars admins get the management tabs beside it on that same page. Hidden
 * entirely for accounts not linked to pwc_tars.
 */
export default function TarsCard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  if (user?.provider !== 'tars') {
    return null;
  }

  const openTools = () => navigate('/mcp-settings?tab=mytools');

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border-light bg-transparent px-3 py-2.5 hover:bg-surface-hover"
      role="button"
      tabIndex={0}
      aria-label={localize('com_ui_tars_mcp_my_tools')}
      onClick={openTools}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTools();
        }
      }}
    >
      <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
        <Wrench className="size-5 text-text-secondary" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {localize('com_ui_tars_mcp_my_tools')}
        </div>
        <p className="truncate text-xs text-text-secondary">
          {localize('com_ui_tars_mcp_card_hint')}
        </p>
      </div>
      <ChevronRight className="size-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
    </div>
  );
}
