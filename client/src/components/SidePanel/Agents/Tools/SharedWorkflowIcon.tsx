import { Users } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';

/**
 * Marks a shared Workflow project beside its name. Langflow names every user's default project
 * like the shared account's ("Starter Project"), so the name alone does not say whose it is.
 * Rendered as a non-focusable span so it can sit inside a card's button.
 */
export default function SharedWorkflowIcon() {
  const localize = useLocalize();
  const label = localize('com_ui_tools_shared_workflow');
  return (
    <TooltipAnchor
      description={label}
      side="top"
      render={
        <span role="img" aria-label={label} className="text-text-secondary inline-flex shrink-0">
          <Users className="size-3.5" aria-hidden="true" />
        </span>
      }
    />
  );
}
