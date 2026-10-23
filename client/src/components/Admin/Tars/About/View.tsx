import { useLocalize } from '~/hooks';
import AboutManager from './Manager';

/** About page, trimmed to the two sections still in use: version history and SBOM downloads. */
export default function AboutView() {
  const localize = useLocalize();

  return (
    <div className="bg-presentation h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-text-primary text-2xl font-semibold">
          {localize('com_ui_tars_nav_about')}
        </h1>
        <AboutManager />
      </div>
    </div>
  );
}
