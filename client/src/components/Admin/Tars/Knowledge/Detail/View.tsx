import { useNavigate, useParams } from 'react-router-dom';
import { useHasTarsRouteAccess } from '~/hooks';
import KnowledgeDetailManager from './Manager';

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
    <div className="bg-presentation h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <KnowledgeDetailManager knowledgeBaseId={kbId} />
      </div>
    </div>
  );
}
