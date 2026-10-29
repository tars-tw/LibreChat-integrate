import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import DatabaseManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars application-database administration (應用資料庫). */
export default function DatabaseView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_app_db')}>
      <DatabaseManager />
    </TarsPage>
  );
}
