import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsMcpServer } from 'librechat-data-provider';
import { useBatchDeleteTarsMcpServersMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function McpBulkDeleteModal({
  servers,
  onOpenChange,
}: {
  servers: TTarsMcpServer[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const mutation = useBatchDeleteTarsMcpServersMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_mcp_bulk_deleted'), status: 'success' });
      onOpenChange(false);
    },
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_mcp_bulk_delete')}
        showCloseButton={true}
        className="w-11/12 max-w-md"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_mcp_bulk_delete_warning', { count: servers.length })}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border-light p-2 text-sm text-text-primary">
              {servers.map((server) => (
                <li key={server.id} className="truncate">
                  {server.name}
                  {server.code != null && server.code !== '' ? ` (${server.code})` : ''}
                </li>
              ))}
            </ul>
          </div>
        }
        buttons={
          <Button
            variant="destructive"
            onClick={() => mutation.mutate(servers.map((server) => server.id))}
            disabled={mutation.isLoading}
          >
            {mutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
          </Button>
        }
      />
    </OGDialog>
  );
}
