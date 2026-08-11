import { useParams, Navigate } from 'react-router-dom';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import TarsPromptForm from '../Tars/Form';
import { useHasAccess } from '~/hooks';

export default function InlinePromptsView() {
  const { promptId } = useParams();

  const hasAccess = useHasAccess({
    permissionType: PermissionTypes.PROMPTS,
    permission: Permissions.USE,
  });

  if (!hasAccess) {
    return <Navigate to="/c/new" replace />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-presentation">
      <TarsPromptForm promptId={promptId} />
    </div>
  );
}
