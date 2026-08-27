import React, { memo } from 'react';
import { Database } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';
import { useLocalize } from '~/hooks';

function SqlAgent() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const sqlAgent = context?.sqlAgent;

  if (!sqlAgent?.isAvailable) {
    return null;
  }
  const { isActive, toggle, isPinned } = sqlAgent;

  return (
    (isPinned || isActive) && (
      <CheckboxButton
        checked={isActive}
        setValue={toggle}
        label={localize('com_ui_tars_sql_agent')}
        isCheckedClassName={badgeAccents.green}
        icon={<Database className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(SqlAgent);
