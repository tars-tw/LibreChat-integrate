import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import IssuesManager from './Manager';
import TarsPage from '../Page';

/** Full-page pwc_tars issue reporting (問題回報). */
export default function IssuesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <TarsPage
      title={localize('com_ui_tars_nav_issues')}
      className="flex min-h-full flex-col gap-6 lg:h-full"
      shellClassName="lg:overflow-hidden"
      titleClassName="shrink-0"
    >
      <IssuesManager />
    </TarsPage>
  );
}
