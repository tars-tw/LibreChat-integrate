import { Construction } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useHasTarsRouteAccess } from '~/hooks';

/** Blank admin page shell used by menu entries whose feature is not built yet. */
export default function AdminPlaceholder({ titleKey }: { titleKey: TranslationKeys }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const hasAccess = useHasTarsRouteAccess();

  if (!hasAccess) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <div className="bg-presentation h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-text-primary text-2xl font-semibold">{localize(titleKey)}</h1>
        <div className="border-border-light text-text-secondary flex flex-col items-center justify-center gap-3 rounded-xl border py-24">
          <Construction className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">{localize('com_ui_tars_page_placeholder')}</p>
        </div>
      </div>
    </div>
  );
}
