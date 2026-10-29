import { useLocalize } from '~/hooks';
import AboutManager from './Manager';
import TarsPage from '../Page';

/** About page, trimmed to the two sections still in use: version history and SBOM downloads. */
export default function AboutView() {
  const localize = useLocalize();

  return (
    <TarsPage title={localize('com_ui_tars_nav_about')}>
      <AboutManager />
    </TarsPage>
  );
}
