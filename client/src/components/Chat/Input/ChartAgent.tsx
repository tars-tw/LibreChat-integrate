import React, { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';

function ChartAgent() {
  const localize = useLocalize();
  const canUseChartAgent = useHasAccess({
    permissionType: PermissionTypes.CHART_AGENT,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  if (!canUseChartAgent || !context) {
    return null;
  }
  const { toggleState: chartAgent, debouncedChange, isPinned } = context.chartAgent;

  return (
    (isPinned || chartAgent) && (
      <CheckboxButton
        checked={chartAgent}
        setValue={debouncedChange}
        label={localize('com_ui_tars_chart_agent')}
        isCheckedClassName={badgeAccents.green}
        icon={<BarChart3 className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(ChartAgent);
