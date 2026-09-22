import { useLocalize } from '~/hooks';
import AboutManager from './Manager';

/** About page, trimmed to the two sections still in use: version history and SBOM downloads. */
export default function AboutView() {
  const localize = useLocalize();

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_nav_about')}
        </h1>
        <AboutManager />
      </div>
    </div>
  );
}
