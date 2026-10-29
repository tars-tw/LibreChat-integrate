import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import TokenQuotaManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars token quota administration (Token 配額設定). */
export default function TokenQuotaView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_audit_tokens')}>
      <TokenQuotaManager />
    </TarsPage>
  );
}
