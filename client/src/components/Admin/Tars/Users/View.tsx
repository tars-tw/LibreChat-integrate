import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import UserManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars account administration (人員管理). */
export default function UsersView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_users')}>
      <UserManager />
    </TarsPage>
  );
}
