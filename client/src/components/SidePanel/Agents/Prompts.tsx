import { memo } from 'react';
import { Info, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TooltipAnchor, disabledInkClasses } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useIsTarsLinkedUser } from '~/hooks/Tars/useTarsChatPrompts';
import { useHasAccess, useLocalize } from '~/hooks';
import { isEphemeralAgent } from '~/common';
import { cn } from '~/utils';

/**
 * The agent builder's 提示詞 section: opens the saved agent's own prompts (`prompt_to_agent`)
 * on the prompts page. Only pwc_tars accounts have prompts there, and an unsaved agent has no
 * id to keep them under yet.
 */
function AgentPrompts({ agent_id }: { agent_id?: string | null }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsUser = useIsTarsLinkedUser();
  const canUsePrompts = useHasAccess({
    permissionType: PermissionTypes.PROMPTS,
    permission: Permissions.USE,
  });

  if (!isTarsUser || !canUsePrompts) {
    return null;
  }

  const isSaved = !!agent_id && !isEphemeralAgent(agent_id);

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-text-secondary text-2xs truncate font-medium tracking-wide uppercase">
            {localize('com_agents_tars_prompts_label')}
          </span>
          <TooltipAnchor
            description={localize('com_agents_tars_prompts_description')}
            side="top"
            render={
              <button
                type="button"
                aria-label={localize('com_agents_tars_prompts_description')}
                className="text-text-tertiary hover:text-text-secondary focus-visible:ring-ring-primary flex size-4 shrink-0 items-center justify-center rounded transition-colors focus:outline-hidden focus-visible:ring-2"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            }
          />
        </div>
        <button
          type="button"
          disabled={!isSaved}
          aria-label={localize('com_agents_tars_prompts_add_aria')}
          className={cn(
            'hover:bg-surface-secondary focus-visible:ring-ring-primary text-accent-primary hover:text-accent-primary inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition focus:outline-hidden focus-visible:ring-2',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
            disabledInkClasses,
          )}
          onClick={() => navigate(`/prompts/agent/${encodeURIComponent(agent_id ?? '')}`)}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          {localize('com_ui_add')}
        </button>
      </div>
      {!isSaved && (
        <p className="text-text-secondary text-2xs leading-snug">
          {localize('com_agents_tars_prompts_disabled')}
        </p>
      )}
    </div>
  );
}

const MemoizedAgentPrompts = memo(AgentPrompts);
MemoizedAgentPrompts.displayName = 'AgentPrompts';

export default MemoizedAgentPrompts;
