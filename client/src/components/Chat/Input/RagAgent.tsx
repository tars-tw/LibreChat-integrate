import React, { memo } from 'react';
import { BookOpen } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function RagAgent() {
  const localize = useLocalize();
  const canUseRagAgent = useHasAccess({
    permissionType: PermissionTypes.RAG_AGENT,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  if (!canUseRagAgent || !context) {
    return null;
  }
  const { toggleState: ragAgent, debouncedChange, isPinned } = context.ragAgent;

  return (
    (isPinned || ragAgent) && (
      <CheckboxButton
        checked={ragAgent}
        setValue={debouncedChange}
        label={localize('com_ui_tars_rag_agent')}
        isCheckedClassName={badgeAccents.green}
        icon={<BookOpen className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(RagAgent);
