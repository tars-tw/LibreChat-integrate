import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import GroupManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars user group administration (群組管理). */
export default function GroupsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_groups')}>
      <GroupManager />
    </TarsPage>
  );
}
