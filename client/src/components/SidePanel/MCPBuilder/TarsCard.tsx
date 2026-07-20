import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, Settings2, ChevronRight } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import McpToolsDialog from '~/components/Tars/McpToolsDialog';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize, useIsTarsAdmin } from '~/hooks';

/**
 * Entry card for the pwc_tars tool source inside the MCP panel — where users
 * naturally look for MCP configuration. Clicking the card opens the user's TARS
 * tool panel (catalog, per-tool toggles, credentials); tars admins get an extra
 * gear that jumps to the /mcp-settings management page (OpenAPI / custom API
 * server CRUD). Hidden entirely for accounts not linked to pwc_tars.
 */
export default function TarsCard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const isTarsAdmin = useIsTarsAdmin();
  const [showTools, setShowTools] = useState(false);

  if (user?.provider !== 'tars') {
    return null;
  }

  return (
    <>
      <div
        className="group flex cursor-pointer items-center gap-3 rounded-lg border border-border-light bg-transparent px-3 py-2.5 hover:bg-surface-hover"
        role="button"
        tabIndex={0}
        aria-label={localize('com_ui_tars_mcp_my_tools')}
        onClick={() => setShowTools(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowTools(true);
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
        <div className="flex flex-shrink-0 items-center gap-1">
          {isTarsAdmin && (
            <TooltipAnchor
              description={localize('com_ui_tars_mcp_settings')}
              side="top"
              render={
                <button
                  type="button"
                  aria-label={localize('com_ui_tars_mcp_settings')}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate('/mcp-settings');
                  }}
                  className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                >
                  <Settings2 className="size-4" aria-hidden="true" />
                </button>
              }
            />
          )}
          <ChevronRight className="size-4 text-text-secondary" aria-hidden="true" />
        </div>
      </div>
      {showTools && <McpToolsDialog open={showTools} onOpenChange={setShowTools} />}
    </>
  );
}
