import { useCallback } from 'react';
import { useLocalize } from '~/hooks';

/** Names a group source: the AD attribute it groups by, or AD group membership when unset. */
export default function useGroupSourceLabel(): (attribute?: string | null) => string {
  const localize = useLocalize();
  return useCallback(
    (attribute?: string | null) =>
      attribute
        ? localize('com_ui_tars_sso_group_source_attribute', { attribute })
        : localize('com_ui_tars_sso_group_source_ad_groups'),
    [localize],
  );
}
