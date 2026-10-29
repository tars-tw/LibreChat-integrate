import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import ScheduleManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars schedule administration (知識庫排程). */
export default function SchedulesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_kb_schedule')}>
      <ScheduleManager />
    </TarsPage>
  );
}
