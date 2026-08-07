import { useNavigate } from 'react-router-dom';
import { Construction } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useIsTarsAdmin } from '~/hooks';

/** Blank admin page shell used by menu entries whose feature is not built yet. */
export default function AdminPlaceholder({ titleKey }: { titleKey: TranslationKeys }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">{localize(titleKey)}</h1>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border-light py-24 text-text-secondary">
          <Construction className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm">{localize('com_ui_tars_page_placeholder')}</p>
        </div>
      </div>
    </div>
  );
}
