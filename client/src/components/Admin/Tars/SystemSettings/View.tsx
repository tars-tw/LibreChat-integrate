import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import SystemSettingsManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars system settings (系統設定). */
export default function SystemSettingsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_system_settings')}>
      <SystemSettingsManager />
    </TarsPage>
  );
}
