import { useNavigate } from 'react-router-dom';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';
import IssuesManager from './Manager';

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
    <div className="bg-presentation h-full w-full overflow-y-auto lg:overflow-hidden">
      <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 p-6 lg:h-full">
        <h1 className="text-text-primary shrink-0 text-2xl font-semibold">
          {localize('com_ui_tars_nav_issues')}
        </h1>
        <IssuesManager />
      </div>
    </div>
  );
}
