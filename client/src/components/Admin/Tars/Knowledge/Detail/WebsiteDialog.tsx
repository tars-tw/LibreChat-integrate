import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetWebsite } from 'librechat-data-provider';
import { useImportTarsWebsiteMutation, useUpdateTarsWebsiteMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Imports a site, or renames one already imported.
 *
 * The URL is fixed at import time — pwc_tars' update endpoint only accepts a
 * name and description, because the crawled chunks belong to the old address.
 */
export default function WebsiteDialog({
  knowledgeBaseId,
  website,
  onClose,
}: {
  knowledgeBaseId: string;
  /** `null` opens the import form. */
  website: TTarsDatasetWebsite | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = website != null;

  const [name, setName] = useState(website?.name ?? '');
  const [url, setUrl] = useState(website?.url ?? '');
  const [description, setDescription] = useState(website?.description ?? '');
  const [enabled, setEnabled] = useState(website == null ? true : website.status === 1);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_kb_ds_import_failed'), status: 'error' });

  const importMutation = useImportTarsWebsiteMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_imported'), status: 'success' });
      onClose();
    },
    onError,
  });

  const updateMutation = useUpdateTarsWebsiteMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
    },
    onError,
  });

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const urlInvalid = !isEdit && !/^https?:\/\/\S+$/.test(trimmedUrl);
  const isBusy = importMutation.isLoading || updateMutation.isLoading;
  const canSave = trimmedName !== '' && !urlInvalid && !isBusy;

  const submit = () => {
    if (!canSave) {
      return;
    }
    if (isEdit && website != null) {
      updateMutation.mutate({ websiteId: website.id, name: trimmedName, description });
      return;
    }
    importMutation.mutate({ name: trimmedName, url: trimmedUrl, description, enabled });
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <OGDialogTemplate
        title={localize(
          isEdit ? 'com_ui_tars_kb_ds_edit_website' : 'com_ui_tars_kb_ds_import_website',
        )}
        className="w-11/12 md:max-w-lg"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tars-site-name">
                {localize('com_ui_tars_kb_ds_name')}
                <span className="ml-0.5 text-pwc-danger">*</span>
              </Label>
              <Input
                id="tars-site-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-site-url">
                {localize('com_ui_tars_kb_ds_url')}
                {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
              </Label>
              <Input
                id="tars-site-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
                disabled={isEdit}
              />
              {isEdit ? (
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_tars_kb_ds_url_locked')}
                </p>
              ) : (
                url !== '' &&
                urlInvalid && (
                  <p className="text-xs text-pwc-danger">
                    {localize('com_ui_tars_kb_ds_url_invalid')}
                  </p>
                )
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-site-description">{localize('com_ui_description')}</Label>
              <textarea
                id="tars-site-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-heavy"
              />
            </div>

            {!isEdit && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light p-3">
                  <Label htmlFor="tars-site-enabled" className="text-sm">
                    {localize('com_ui_tars_kb_ds_enable')}
                  </Label>
                  <Switch
                    id="tars-site-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    aria-label={localize('com_ui_tars_kb_ds_enable')}
                  />
                </div>
                {/* Crawling, chunking and embedding all happen before the
                    response returns, so this can take minutes on a large site. */}
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_tars_kb_ds_import_slow')}
                </p>
              </>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canSave}>
            {isBusy ? (
              <Spinner className="size-4" />
            ) : (
              localize(isEdit ? 'com_ui_save' : 'com_ui_tars_kb_ds_import')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
