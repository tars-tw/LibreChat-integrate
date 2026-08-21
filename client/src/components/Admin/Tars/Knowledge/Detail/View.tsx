import { useNavigate, useParams } from 'react-router-dom';
import KnowledgeDetailManager from './Manager';
import { useIsTarsAdmin } from '~/hooks';

/** Full-page pwc_tars knowledge-base detail (知識庫資料集). */
export default function KnowledgeDetailView() {
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();
  const { kbId = '' } = useParams();

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <KnowledgeDetailManager knowledgeBaseId={kbId} />
      </div>
    </div>
  );
}
