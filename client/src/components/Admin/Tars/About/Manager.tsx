import { useMemo } from 'react';
import { useTarsReleaseNotesQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import History from './History';
import Files from './Files';

export default function AboutManager() {
  const localize = useLocalize();
  const releaseNotesQuery = useTarsReleaseNotesQuery();

  const notes = useMemo(() => releaseNotesQuery.data ?? [], [releaseNotesQuery.data]);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border-light">
        <header className="border-b border-border-light px-4 py-3">
          <h2 className="text-base font-medium text-text-primary">
            {localize('com_ui_tars_about_release_notes')}
          </h2>
        </header>

        <div className="p-4">
          <History notes={notes} isLoading={releaseNotesQuery.isLoading} />
        </div>
      </section>

      <section className="rounded-xl border border-border-light">
        <header className="border-b border-border-light px-4 py-3">
          <h2 className="text-base font-medium text-text-primary">
            {localize('com_ui_tars_about_sbom')}
          </h2>
        </header>

        <div className="p-4">
          <Files />
        </div>
      </section>
    </div>
  );
}
