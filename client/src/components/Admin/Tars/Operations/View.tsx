import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import OperationsManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars system operation audit (系統操作稽核). */
export default function OperationsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_audit_operations')}>
      <OperationsManager />
    </TarsPage>
  );
}
