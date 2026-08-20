import { useRef, useState } from 'react';
import { ImageOff, Upload } from 'lucide-react';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import { useUploadTarsSystemLogoMutation, useRemoveTarsSystemLogoMutation } from '~/data-provider';
import { systemLogoSrc } from './helpers';
import { useLocalize } from '~/hooks';
import Card from './Card';

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/gif';
const MAX_BYTES = 2 * 1024 * 1024;

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/** The preview slot: a pending upload wins, then the stored logo, then a placeholder. */
function LogoPreview({
  previewUrl,
  version,
  hasLogo,
  onMissing,
}: {
  previewUrl?: string;
  version: number;
  hasLogo: boolean;
  onMissing: () => void;
}) {
  const localize = useLocalize();

  if (previewUrl != null) {
    return (
      <img
        src={previewUrl}
        alt={localize('com_ui_tars_settings_logo_preview')}
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  if (hasLogo) {
    return (
      <img
        src={systemLogoSrc(version)}
        alt={localize('com_ui_tars_settings_logo_current')}
        className="max-h-full max-w-full object-contain"
        onError={onMissing}
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-1 text-text-secondary">
      <ImageOff className="h-5 w-5" aria-hidden="true" />
      <span className="text-xs">{localize('com_ui_tars_settings_logo_none')}</span>
    </div>
  );
}

/**
 * System logo management. The stored logo lives in pwc_tars and is written
 * through pwc_tars' own settings endpoint, so pwc_tars 1.0 keeps rendering it;
 * LibreChat reads it back through a proxy and uses it on the login page.
 */
export default function LogoCard() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement>(null);

  /** Bumped after every change so the browser re-fetches the proxied image. */
  const [version, setVersion] = useState(() => Date.now());
  const [hasLogo, setHasLogo] = useState(true);
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const clearPending = () => {
    setPending((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
  };

  const uploadMutation = useUploadTarsSystemLogoMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_settings_logo_updated'), status: 'success' });
      clearPending();
      setHasLogo(true);
      setVersion(Date.now());
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const removeMutation = useRemoveTarsSystemLogoMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_settings_logo_removed'), status: 'success' });
      setConfirmingRemove(false);
      setHasLogo(false);
      setVersion(Date.now());
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast({ message: localize('com_ui_tars_settings_logo_too_large'), status: 'error' });
      return;
    }
    clearPending();
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  };

  const handleConfirm = () => {
    if (!pending) {
      return;
    }
    const formData = new FormData();
    formData.append('file', pending.file);
    uploadMutation.mutate(formData);
  };

  return (
    <Card
      title={localize('com_ui_tars_settings_logo')}
      description={localize('com_ui_tars_settings_logo_hint')}
    >
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-border-light bg-surface-secondary p-2">
          <LogoPreview
            previewUrl={pending?.previewUrl}
            version={version}
            hasLogo={hasLogo}
            onMissing={() => setHasLogo(false)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            aria-hidden="true"
            onChange={handlePick}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="icon-sm mr-1" />
            {localize('com_ui_tars_settings_logo_choose')}
          </Button>
          {pending != null && (
            <>
              <Button variant="submit" onClick={handleConfirm} disabled={uploadMutation.isLoading}>
                {uploadMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_tars_settings_logo_confirm')
                )}
              </Button>
              <Button variant="ghost" onClick={clearPending} disabled={uploadMutation.isLoading}>
                {localize('com_ui_cancel')}
              </Button>
            </>
          )}
          {pending == null && hasLogo && (
            <Button variant="destructive" onClick={() => setConfirmingRemove(true)}>
              {localize('com_ui_tars_settings_logo_remove')}
            </Button>
          )}
        </div>
      </div>

      {pending != null && (
        <p className="text-xs text-text-secondary">
          {localize('com_ui_tars_settings_logo_pending')}
        </p>
      )}

      {confirmingRemove && (
        <OGDialog open={true} onOpenChange={(open) => !open && setConfirmingRemove(false)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_settings_logo_remove')}
            showCloseButton={true}
            className="w-11/12 max-w-md"
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_settings_logo_remove_confirm')}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isLoading}
              >
                {removeMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </Card>
  );
}
