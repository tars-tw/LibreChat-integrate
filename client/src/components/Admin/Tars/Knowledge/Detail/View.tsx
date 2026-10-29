import { useNavigate, useParams } from 'react-router-dom';
import { useHasTarsRouteAccess } from '~/hooks';
import KnowledgeDetailManager from './Manager';
import TarsPage from '../../Page';

/** Full-page pwc_tars knowledge-base detail (知識庫資料集). */
export default function KnowledgeDetailView() {
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();
  const { kbId = '' } = useParams();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage>
      <KnowledgeDetailManager knowledgeBaseId={kbId} />
    </TarsPage>
  );
}
