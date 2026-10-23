import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type {
  TPrincipal,
  TTarsMcpServer,
  TPrincipalSearchResult,
  TTarsMcpPermissionPrincipal,
} from 'librechat-data-provider';
import {
  useTarsMcpServersQuery,
  usePrincipalDirectoryQuery,
  useDeleteTarsMcpPermissionsMutation,
  useTarsMcpPermissionPrincipalsQuery,
} from '~/data-provider';
import { errorMessage } from '~/components/Admin/Tars/Models/helpers';
import McpPermissionPrincipals from './McpPermissionPrincipals';
import McpPermissionServers from './McpPermissionServers';
import McpServerAssignModal from './McpServerAssignModal';
import McpPermissionEditor from './McpPermissionEditor';
import { MANAGED_TYPES } from './servers';
import { useLocalize } from '~/hooks';

/** An overview row as a share-dialog principal, enriched from the directory when it is there. */
const toEditTarget = (
  principal: TTarsMcpPermissionPrincipal,
  directoryEntry: TPrincipalSearchResult | undefined,
): TPrincipal => ({
  type: principal.principal_type === 'group' ? PrincipalType.GROUP : PrincipalType.USER,
  name: principal.name,
  email: principal.email ?? undefined,
  source: 'tars',
  idOnTheSource: principal.principal_id,
  avatar: directoryEntry?.avatar,
  memberCount: directoryEntry?.memberCount,
});

/**
 * MCP permissions: which users and groups each server is assigned to, everyone holding
 * grants, and two ways into the same grants — the principal dialog (opened empty from
 * 新增權限 or on one principal's saved grants from its edit action) and the server dialog
 * (one server's assignees, from its row in the overview).
 */
export default function McpPermissionsTab() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: servers = [], isLoading: serversLoading } = useTarsMcpServersQuery();
  const { data: principals = [], isLoading: principalsLoading } =
    useTarsMcpPermissionPrincipalsQuery();
  const { data: directory } = usePrincipalDirectoryQuery();

  /** The open dialog's starting targets; `null` while it is closed. */
  const [editorTargets, setEditorTargets] = useState<TPrincipal[] | null>(null);
  const [removing, setRemoving] = useState<TTarsMcpPermissionPrincipal | null>(null);
  /** The server being assigned from the server side; `null` while that dialog is closed. */
  const [assigning, setAssigning] = useState<TTarsMcpServer | null>(null);

  const managedServers = useMemo(
    () => servers.filter((server) => MANAGED_TYPES.has(server.type)),
    [servers],
  );

  const directoryById = useMemo(() => {
    const map = new Map<string, TPrincipalSearchResult>();
    for (const entry of [...(directory?.users ?? []), ...(directory?.groups ?? [])]) {
      if (entry.idOnTheSource) {
        map.set(entry.idOnTheSource, entry);
      }
    }
    return map;
  }, [directory]);

  const editPrincipal = (principal: TTarsMcpPermissionPrincipal) =>
    setEditorTargets([toEditTarget(principal, directoryById.get(principal.principal_id))]);

  const deleteMutation = useDeleteTarsMcpPermissionsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_mcp_permission_removed'), status: 'success' });
      setRemoving(null);
    },
    onError: (error: unknown) =>
      showToast({
        message: errorMessage(error) ?? (error as Error)?.message ?? 'Error',
        status: 'error',
      }),
  });

  if (serversLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <McpPermissionServers
        servers={servers}
        principals={principals}
        principalsLoading={principalsLoading}
        onAssign={setAssigning}
        actions={
          <Button variant="submit" onClick={() => setEditorTargets([])}>
            <Plus className="icon-sm mr-1" aria-hidden="true" />
            {localize('com_ui_tars_mcp_add_permission')}
          </Button>
        }
      />

      <McpPermissionPrincipals
        principals={principals}
        isLoading={principalsLoading}
        onEdit={editPrincipal}
        onRemove={setRemoving}
      />

      {editorTargets != null && (
        <McpPermissionEditor
          servers={managedServers}
          initialTargets={editorTargets}
          onClose={() => setEditorTargets(null)}
        />
      )}

      {assigning != null && (
        <McpServerAssignModal server={assigning} onClose={() => setAssigning(null)} />
      )}

      {removing != null && (
        <OGDialog open={removing != null} onOpenChange={(open) => !open && setRemoving(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_mcp_permission_remove')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_mcp_permission_remove_confirm', { name: removing.name })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() =>
                  deleteMutation.mutate({
                    type: removing.principal_type,
                    id: removing.principal_id,
                  })
                }
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
