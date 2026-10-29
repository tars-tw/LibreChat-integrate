import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import DomainManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars specialized-brain administration (專用腦管理). */
export default function DomainsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_domains')}>
      <DomainManager />
    </TarsPage>
  );
}
