import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import SysConfigManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars system parameter administration (系統參數設定). */
export default function SysConfigView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_sys_config')}>
      <SysConfigManager />
    </TarsPage>
  );
}
