import { useNavigate } from 'react-router-dom';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import RoleManager from './Manager';

/** Full-page pwc_tars role administration (權限管理). */
export default function RolesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_nav_permissions')}
        </h1>
        <RoleManager />
      </div>
    </div>
  );
}
