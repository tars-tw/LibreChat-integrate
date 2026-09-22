import { useState } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Proxied pwc_tars system logo; unauthenticated so the login page can use it. */
const TARS_LOGO_SRC = '/api/tars/settings/logo';

/**
 * The login page wordmark. Administrators upload a logo on the pwc_tars system
 * settings page; when none is stored the logo is hidden.
 */
export default function BrandLogo({ className }: { className?: string }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const [src, setSrc] = useState<string | null>(TARS_LOGO_SRC);

  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      className={className}
      onError={() => setSrc(null)}
      alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'TARS.ai' })}
    />
  );
}
