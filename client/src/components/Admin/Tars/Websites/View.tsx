import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import WebsiteManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars website administration (外部網站). */
export default function WebsiteView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_websites')}>
      <WebsiteManager />
    </TarsPage>
  );
}
