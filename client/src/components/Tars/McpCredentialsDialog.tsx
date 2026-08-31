import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsMcpUserServer } from 'librechat-data-provider';
import McpCredentialsForm from './McpCredentialsForm';
import { useLocalize } from '~/hooks';

interface McpCredentialsDialogProps {
  server: TTarsMcpUserServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Credential entry for one pwc_tars MCP server, reachable from the chat server
 * menu so a user who never opens the TARS tools panel can still authenticate.
 */
export default function McpCredentialsDialog({
  server,
  open,
  onOpenChange,
}: McpCredentialsDialogProps) {
  const localize = useLocalize();

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={server.name}
        showCloseButton={true}
        showCancelButton={false}
        className="w-11/12 md:max-w-md"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_mcp_creds_dialog_hint')}
            </p>
            <McpCredentialsForm server={server} onSaved={() => onOpenChange(false)} />
          </div>
        }
      />
    </OGDialog>
  );
}
