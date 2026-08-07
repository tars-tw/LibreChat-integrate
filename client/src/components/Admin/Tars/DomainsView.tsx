import { useNavigate } from 'react-router-dom';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import DomainManager from './DomainManager';

/** Full-page specialized-brain (domain) administration, replacing the former dialog. */
export default function DomainsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_nav_domains')}
        </h1>
        <DomainManager />
      </div>
    </div>
  );
}
