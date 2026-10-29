import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import FileSystemManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars document-group administration (文檔群組). */
export default function FileSystemView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_doc_groups')}>
      <FileSystemManager />
    </TarsPage>
  );
}
