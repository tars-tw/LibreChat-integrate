import { useRef, useState, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import { useImportTarsLicenseMutation, useTarsLicenseStatusQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

type TarsLicenseUploadProps = {
  children: React.ReactNode;
  /**
   * The `licenseStatus` pwc_tars reported on the most recent failed login
   * attempt, if any. pwc_tars only re-validates the licence file's existence
   * at login time (`/api/auth/login`), not on the settings read this
   * component otherwise polls (`/api/settings/prepare_data`, which can keep
   * reporting a stale 'activate' after the file is deleted until someone logs
   * in again) — so a login failure carrying this is the authoritative signal
   * and overrides whatever the status query last saw.
   */
  forcedLicenseStatus?: string;
  /** Called after a successful upload so the caller can clear `forcedLicenseStatus`. */
  onUploaded?: () => void;
};

/**
 * Blocks login on the pwc_tars login page when the licence pwc_tars holds is
 * missing or expired, and lets an unauthenticated visitor upload a new one —
 * mirroring pwc_tars's own `showLicenseUpload` flow in `JWTLogin.jsx`. Checked
 * two ways: up front via the public `GET /api/tars/settings/license-status`,
 * and authoritatively via `forcedLicenseStatus` whenever a login attempt itself
 * reveals the licence problem.
 */
export default function TarsLicenseUpload({
  children,
  forcedLicenseStatus,
  onUploaded,
}: TarsLicenseUploadProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: settings, isLoading, refetch } = useTarsLicenseStatusQuery();

  /**
   * Submitting the login form clears the entire react-query cache (see
   * `useLoginUserMutation`'s `onMutate`) so stale app state doesn't leak into the
   * new session — this query is no exception. Since this component stays mounted
   * through a login attempt, that wipe briefly flips `isLoading` back to `true`
   * for an already-resolved query. Gating on `isLoading` directly would unmount
   * `children` (the login form, with the credentials the user just typed) for
   * that instant and remount it once the background refetch finishes, which
   * both loses the form's state and makes a login that actually succeeds look
   * like it bounced back to a fresh login page first. Latching the last known
   * status instead means only a login attempt's own real result (via
   * `forcedLicenseStatus`) can change what's shown once the first load settles.
   */
  const [lastKnownStatus, setLastKnownStatus] = useState<string | undefined>(undefined);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (settings?.licenseStatus != null) {
      setLastKnownStatus(settings.licenseStatus);
      hasLoadedOnceRef.current = true;
    }
  }, [settings?.licenseStatus]);

  const importMutation = useImportTarsLicenseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_settings_license_imported'), status: 'success' });
      onUploaded?.();
      refetch();
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_settings_license_failed'),
        status: 'error',
      }),
  });

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    importMutation.mutate(formData);
  };

  const isForcedInactive = forcedLicenseStatus != null && forcedLicenseStatus !== 'activate';

  /** Only the very first, never-yet-resolved load blocks on a spinner — once we've read a
   *  status once, a later cache-cleared reload (see the hook above) must not hide `children`
   *  again while it's in flight. */
  if (isLoading && !isForcedInactive && !hasLoadedOnceRef.current) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  const effectiveStatus = forcedLicenseStatus ?? lastKnownStatus;
  const requiresLicense = effectiveStatus != null && effectiveStatus !== 'activate';
  if (!requiresLicense) {
    return <>{children}</>;
  }

  return (
    <div className="mt-4 rounded-2xl border border-border-light bg-surface-primary p-4 text-center">
      <p className="text-sm text-text-primary">{localize('com_ui_tars_login_license_required')}</p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".key"
          className="hidden"
          aria-hidden="true"
          onChange={handlePick}
        />
        <Button
          variant="submit"
          className="rounded-md text-white"
          onClick={() => inputRef.current?.click()}
          disabled={importMutation.isLoading}
        >
          {importMutation.isLoading ? (
            <Spinner className="icon-sm mr-1" />
          ) : (
            <Upload className="icon-sm mr-1" />
          )}
          {localize('com_ui_tars_settings_license_upload')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        {localize('com_ui_tars_settings_license_format')}
      </p>
    </div>
  );
}
