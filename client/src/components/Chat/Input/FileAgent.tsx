import React, { memo } from 'react';
import { FileOutput } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function FileAgent() {
  const localize = useLocalize();
  const canUseFileAgent = useHasAccess({
    permissionType: PermissionTypes.FILE_AGENT,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  if (!canUseFileAgent || !context) {
    return null;
  }
  const { toggleState: fileAgent, debouncedChange, isPinned } = context.fileAgent;

  return (
    (isPinned || fileAgent) && (
      <CheckboxButton
        checked={fileAgent}
        setValue={debouncedChange}
        label={localize('com_ui_tars_file_agent')}
        isCheckedClassName={badgeAccents.amber}
        icon={<FileOutput className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(FileAgent);
