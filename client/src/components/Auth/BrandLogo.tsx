import { useState } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Proxied pwc_tars system logo; unauthenticated so the login page can use it. */
const TARS_LOGO_SRC = '/api/tars/settings/logo';
const FALLBACK_SRC = 'assets/logo.svg';

/**
 * The login page wordmark. Administrators upload a logo on the pwc_tars system
 * settings page; when none is stored the proxy answers 404 and the bundled
 * LibreChat mark is used instead.
 */
export default function BrandLogo({ className }: { className?: string }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const [src, setSrc] = useState(TARS_LOGO_SRC);

  return (
    <img
      src={src}
      className={className}
      onError={() => setSrc(FALLBACK_SRC)}
      alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'TARS.ai' })}
    />
  );
}
