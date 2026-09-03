import { useParams, Navigate } from 'react-router-dom';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import TarsPromptList from '../Tars/List';
import TarsPromptForm from '../Tars/Form';
import { useHasAccess } from '~/hooks';

export default function InlinePromptsView() {
  const { promptId, domainId, knowledgeBaseId } = useParams();

  const hasAccess = useHasAccess({
    permissionType: PermissionTypes.PROMPTS,
    permission: Permissions.USE,
  });

  if (!hasAccess) {
    return <Navigate to="/c/new" replace />;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-presentation">
      <div className="hidden h-full md:flex">
        <TarsPromptList
          domainId={domainId}
          knowledgeBaseId={knowledgeBaseId}
          activePromptId={promptId}
        />
      </div>
      <div className="h-full min-w-0 flex-1 overflow-y-auto">
        <TarsPromptForm promptId={promptId} domainId={domainId} knowledgeBaseId={knowledgeBaseId} />
      </div>
    </div>
  );
}
