import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import ModelKeysManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars model key administration (模型金鑰管理). */
export default function ModelKeysView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_model_keys')}>
      <ModelKeysManager />
    </TarsPage>
  );
}
