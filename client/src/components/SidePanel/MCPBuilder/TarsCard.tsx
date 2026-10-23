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
      className="group border-border-light hover:bg-surface-hover flex cursor-pointer items-center gap-3 rounded-lg border bg-transparent px-3 py-2.5"
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
      <div className="bg-surface-tertiary flex size-8 flex-shrink-0 items-center justify-center rounded-lg">
        <Wrench className="text-text-secondary size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-text-primary truncate text-sm font-medium">
          {localize('com_ui_tars_mcp_my_tools')}
        </div>
        <p className="text-text-secondary truncate text-xs">
          {localize('com_ui_tars_mcp_card_hint')}
        </p>
      </div>
      <ChevronRight className="text-text-secondary size-4 flex-shrink-0" aria-hidden="true" />
    </div>
  );
}
