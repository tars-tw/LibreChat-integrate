import LicenseCard from './License';
import LogoCard from './Logo';
import SsoCard from './Sso';

/** The three pwc_tars system settings LibreChat administers. */
export default function SystemSettingsManager() {
  return (
    <div className="space-y-4">
      <LogoCard />
      <SsoCard />
      <LicenseCard />
    </div>
  );
}
