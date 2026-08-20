import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import { useTarsSystemSettingsQuery, useImportTarsLicenseMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import Card from './Card';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/** pwc_tars marks a valid licence 'activate'; anything else is expired or absent. */
const isActivated = (status: string): boolean => status === 'activate';

export default function LicenseCard() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: settings, isLoading } = useTarsSystemSettingsQuery();

  const importMutation = useImportTarsLicenseMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_settings_license_imported'), status: 'success' }),
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

  const status = settings?.licenseStatus ?? '';
  const activated = isActivated(status);

  return (
    <Card
      title={localize('com_ui_tars_settings_license')}
      description={localize('com_ui_tars_settings_license_hint')}
    >
      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-text-secondary">
                {localize('com_ui_tars_users_status')}
              </p>
              <span
                className={`mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                  activated
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                }`}
              >
                {activated
                  ? localize('com_ui_tars_settings_license_active')
                  : localize('com_ui_tars_settings_license_expired')}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-text-secondary">
                {localize('com_ui_tars_settings_license_start')}
              </p>
              <p className="mt-1 text-sm text-text-primary">{settings?.licenseStartDate || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-text-secondary">
                {localize('com_ui_tars_settings_license_end')}
              </p>
              <p className="mt-1 text-sm text-text-primary">{settings?.licenseEndDate || '—'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".key"
              className="hidden"
              aria-hidden="true"
              onChange={handlePick}
            />
            <Button
              variant="outline"
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
            <span className="text-xs text-text-secondary">
              {localize('com_ui_tars_settings_license_format')}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
