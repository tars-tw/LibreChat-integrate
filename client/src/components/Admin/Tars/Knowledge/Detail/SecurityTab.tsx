import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type {
  TTarsPrincipalInfo,
  TTarsDataSecurityLevel,
  TTarsDataSecurityAssignment,
} from 'librechat-data-provider';
import type { AssigneeRef } from '~/components/Tars/AssignDialog';
import AssignDialog, {
  AssigneeTable,
  byTypeThenName,
  toAssigneeRef,
} from '~/components/Tars/AssignDialog';
import { permissionPrincipalKey } from '~/components/McpSettings/McpPermissionPrincipals';
import { useSaveTarsKnowledgeBaseSecurityMutation } from '~/data-provider';
import ConfirmDialog from './ConfirmDialog';
import { relayedError } from '../helpers';
import { matchesName } from './helpers';
import { useLocalize } from '~/hooks';
import { LevelChip } from './Level';

/** One level's assignees: assigning replaces the whole list, removing saves at once. */
function LevelCard({
  knowledgeBaseId,
  level,
  levels,
}: {
  knowledgeBaseId: string;
  level: TTarsDataSecurityAssignment;
  levels: TTarsDataSecurityLevel[];
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<TTarsPrincipalInfo | null>(null);

  const saveMutation = useSaveTarsKnowledgeBaseSecurityMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({
        message: localize('com_ui_tars_kb_security_saved', { name: level.name }),
        status: 'success',
      });
      setAssigning(false);
      setRemoving(null);
    },
    onError: (error) =>
      showToast({
        message: relayedError(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const save = (principals: AssigneeRef[]) =>
    saveMutation.mutate({ levelId: level.id, data: { principals } });

  const remaining = (assignee: TTarsPrincipalInfo) =>
    level.principals
      .filter((entry) => permissionPrincipalKey(entry) !== permissionPrincipalKey(assignee))
      .map(toAssigneeRef);

  const rows = useMemo(
    () =>
      level.principals
        .filter((entry) => matchesName(`${entry.name} ${entry.email ?? ''}`, search))
        .sort(byTypeThenName),
    [level.principals, search],
  );

  const assigned = level.principals.length > 0;

  return (
    <section className="space-y-3" aria-labelledby={`tars-security-${level.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 id={`tars-security-${level.id}`} className="text-sm font-medium">
            <LevelChip levels={levels} levelId={level.id} />
          </h3>
          {level.description != null && (
            <p className="text-text-secondary text-xs">{level.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {assigned && (
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={localize('com_ui_tars_kb_security_search')}
              aria-label={localize('com_ui_tars_kb_security_search')}
              className="min-w-[14rem]"
            />
          )}
          <Button variant="outline" onClick={() => setAssigning(true)}>
            <UserPlus className="size-4" aria-hidden />
            {localize('com_ui_tars_kb_security_assign')}
          </Button>
        </div>
      </div>

      {!assigned && (
        <p className="border-border-medium text-text-secondary rounded-lg border border-dashed py-6 text-center text-sm">
          {localize('com_ui_tars_kb_security_empty')}
        </p>
      )}
      {assigned && rows.length === 0 && (
        <p className="text-text-secondary py-6 text-center text-sm">
          {localize('com_ui_tars_kb_security_no_match')}
        </p>
      )}
      {rows.length > 0 && <AssigneeTable rows={rows} onRemove={setRemoving} />}

      {assigning && (
        <AssignDialog
          title={localize('com_ui_tars_kb_security_assign_title', { name: level.name })}
          hint={localize('com_ui_tars_kb_security_assign_hint')}
          emptyText={localize('com_ui_tars_kb_security_empty')}
          saved={level.principals}
          isSaving={saveMutation.isLoading}
          onSave={save}
          onClose={() => setAssigning(false)}
        />
      )}

      {removing != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_security_remove_title')}
          message={localize('com_ui_tars_kb_security_remove_confirm', {
            name: removing.name,
            level: level.name,
          })}
          confirmLabel={localize('com_ui_tars_mcp_unassign')}
          destructive
          isBusy={saveMutation.isLoading}
          onConfirm={() => save(remaining(removing))}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

/** Who may read each data security level of this knowledge base. */
export default function SecurityTab({
  knowledgeBaseId,
  levels,
  isLoading,
  isError,
}: {
  knowledgeBaseId: string;
  levels: TTarsDataSecurityAssignment[];
  isLoading: boolean;
  isError: boolean;
}) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-text-secondary py-12 text-center text-sm">
        {localize('com_ui_tars_kb_security_load_failed')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-text-secondary text-sm">{localize('com_ui_tars_kb_security_hint')}</p>
      {levels.map((level) => (
        <LevelCard key={level.id} knowledgeBaseId={knowledgeBaseId} level={level} levels={levels} />
      ))}
    </div>
  );
}
