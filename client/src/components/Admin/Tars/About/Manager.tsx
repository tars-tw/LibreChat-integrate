import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
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
      <section className="border-border-light rounded-xl border">
        <header className="border-border-light border-b px-4 py-3">
          <h2 className="text-text-primary text-base font-medium">
            {localize('com_ui_tars_about_release_notes')}
          </h2>
        </header>

        <div className="p-4">
          <History notes={notes} isLoading={releaseNotesQuery.isLoading} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* SBOM */}
        <section className="border-border-light rounded-xl border">
          <header className="border-border-light border-b px-4 py-3">
            <h2 className="text-text-primary text-base font-medium">
              {localize('com_ui_tars_about_sbom')}
            </h2>
          </header>

          <div className="p-4">
            <Files />
          </div>
        </section>

        {/* Database Licenses */}
        <section className="border-border-light rounded-xl border">
          <header className="border-border-light border-b px-4 py-3">
            <h2 className="text-text-primary text-base font-medium">
              {localize('com_ui_tars_about_database_licenses')}
            </h2>
          </header>

          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="text-text-primary text-sm">{'PostgreSQL'}</span>
              <a
                href="https://www.postgresql.org/about/licence/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link-inline inline-flex items-center gap-1 text-sm font-medium underline"
              >
                <ExternalLink className="text-category-icon-2 size-3.5" />
                {'PostgreSQL License'}
              </a>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-text-primary text-sm">{'Milvus'}</span>
              <a
                href="https://github.com/milvus-io/milvus/blob/master/LICENSE?utm_source=chatgpt.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link-inline inline-flex items-center gap-1 text-sm font-medium underline"
              >
                <ExternalLink className="text-category-icon-2 size-3.5" />
                {'Apache License 2.0'}
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
