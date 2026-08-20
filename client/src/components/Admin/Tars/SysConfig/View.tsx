import { useNavigate } from 'react-router-dom';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import SysConfigManager from './Manager';

/** Full-page pwc_tars system parameter administration (系統參數設定). */
export default function SysConfigView() {
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
          {localize('com_ui_tars_sys_config')}
        </h1>
        <SysConfigManager />
      </div>
    </div>
  );
}
