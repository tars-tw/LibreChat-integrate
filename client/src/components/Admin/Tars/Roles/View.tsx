import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import RoleManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars role administration (權限管理). */
export default function RolesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_permissions')}>
      <RoleManager />
    </TarsPage>
  );
}
