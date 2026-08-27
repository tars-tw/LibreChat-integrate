import React, { memo } from 'react';
import { Database } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function SqlAgent() {
  const localize = useLocalize();
  const canUseSqlAgent = useHasAccess({
    permissionType: PermissionTypes.SQL_AGENT,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  if (!canUseSqlAgent || !context) {
    return null;
  }
  const { toggleState: sqlAgent, debouncedChange, isPinned } = context.sqlAgent;

  return (
    (isPinned || sqlAgent) && (
      <CheckboxButton
        checked={sqlAgent}
        setValue={debouncedChange}
        label={localize('com_ui_tars_sql_agent')}
        isCheckedClassName={badgeAccents.green}
        icon={<Database className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(SqlAgent);
