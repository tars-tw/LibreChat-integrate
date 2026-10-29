import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import AuditManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars message audit report (訊息稽核報表). */
export default function AuditView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_audit_messages')}>
      <AuditManager />
    </TarsPage>
  );
}
