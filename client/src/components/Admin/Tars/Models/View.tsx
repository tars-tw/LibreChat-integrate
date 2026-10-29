import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import ModelProfileManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars model profile administration (模型管理). */
export default function ModelsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_model_management')}>
      <ModelProfileManager />
    </TarsPage>
  );
}
