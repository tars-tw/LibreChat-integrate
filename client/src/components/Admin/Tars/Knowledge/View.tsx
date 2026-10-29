import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import KnowledgeManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars knowledge-base administration (知識庫管理). */
export default function KnowledgeView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage title={localize('com_ui_tars_nav_kb_list')}>
      <KnowledgeManager />
    </TarsPage>
  );
}
