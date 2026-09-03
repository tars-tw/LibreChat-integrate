import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import ModelKeysManager from './Manager';

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
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_nav_model_keys')}
        </h1>
        <ModelKeysManager />
      </div>
    </div>
  );
}
