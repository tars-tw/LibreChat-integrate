import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
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
import type { TTarsWebsiteSource } from 'librechat-data-provider';
import type { WebsiteForm } from './helpers';
import {
  NAME_MAX,
  NAME_MIN,
  boundIds,
  emptyWebsiteForm,
  errorMessage,
  knowledgeBasePickerOptions,
  nameInvalid,
  toWebsiteForm,
  urlInvalid,
} from './helpers';
import { useSaveTarsWebsiteBindingsMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';
import UnbindWarning from './Unbind';

/**
 * Imports a site, or edits one already imported.
 *
 * A site can be bound to several knowledge bases. On edit, pwc_tars unbinds the
 * bases that were unticked and reports the newly ticked ones, which are then
 * imported one at a time.
 *
 * Importing is not a form submission that returns immediately: pwc_tars
 * crawls, chunks and embeds inside the request, which is why the dialog stays
 * open with a busy state rather than closing optimistically.
 *
 * The URL is fixed at import time — pwc_tars does not re-crawl on an edit, so a
 * changed address would not match its chunks.
 */
export default function WebsiteModal({
  website,
  knowledgeBases,
  onClose,
}: {
  /** `null` opens the import form. */
  website: TTarsWebsiteSource | null;
  knowledgeBases: { id: string; name: string }[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = website != null;

  const [form, setForm] = useState<WebsiteForm>(
    website != null ? toWebsiteForm(website) : emptyWebsiteForm,
  );

  const kbOptions = useMemo(() => knowledgeBasePickerOptions(knowledgeBases), [knowledgeBases]);
  const kbName = (id: string) => knowledgeBases.find((kb) => kb.id === id)?.name ?? id;

  const initialIds = isEdit ? boundIds(website) : [];
  const removedNames = initialIds.filter((id) => !form.knowledgeBaseIds.includes(id)).map(kbName);
  const importsAny = form.knowledgeBaseIds.some((id) => !initialIds.includes(id));

  const onSaved = () => {
    showToast({
      message: localize(isEdit ? 'com_ui_tars_web_saved' : 'com_ui_tars_web_imported'),
      status: 'success',
    });
    onClose();
  };
  const onFailed = (error: unknown) =>
    showToast({
      message:
        errorMessage(error) ??
        localize(isEdit ? 'com_ui_tars_web_save_failed' : 'com_ui_tars_web_import_failed'),
      status: 'error',
    });

  const saveMutation = useSaveTarsWebsiteBindingsMutation({
    onSuccess: ({ failed }) => {
      if (failed.length === 0) {
        onSaved();
        return;
      }
      showToast({
        message: `${localize('com_ui_tars_web_partial_failed')}: ${failed.map(kbName).join(', ')}`,
        status: 'error',
      });
      /** The site now exists, so a retry goes through edit, which imports only
       *  the bases still missing; re-running this form would re-import all. */
      onClose();
    },
    onError: onFailed,
  });

  const set = <K extends keyof WebsiteForm>(key: K, value: WebsiteForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const invalidName = nameInvalid(form.name);
  const invalidUrl = urlInvalid(form.url);
  const isBusy = saveMutation.isLoading;
  const canSave = !invalidName && !isBusy && (isEdit || !invalidUrl);

  const submit = () => {
    if (!canSave) {
      return;
    }
    saveMutation.mutate({
      id: isEdit ? website.id : undefined,
      name: form.name.trim(),
      url: form.url.trim(),
      description: form.description,
      enabled: form.enabled,
      knowledgeBaseIds: form.knowledgeBaseIds,
    });
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_ui_tars_web_edit' : 'com_ui_tars_web_new')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        mainClassName="min-w-0"
        main={
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Picker
                id="tars-web-kbs"
                label={localize('com_ui_tars_web_knowledge_base')}
                options={kbOptions}
                selected={form.knowledgeBaseIds}
                onChange={(values) => set('knowledgeBaseIds', values)}
                placeholder={localize('com_ui_tars_web_select_knowledge_base')}
              />
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_web_knowledge_base_hint')}
              </p>
              {removedNames.length > 0 && (
                <UnbindWarning
                  label={localize('com_ui_tars_web_unbind_warning')}
                  names={removedNames}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-web-name">
                {localize('com_ui_tars_web_name')}
                <span className="ml-0.5 text-pwc-danger">*</span>
              </Label>
              <Input
                id="tars-web-name"
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder={localize('com_ui_tars_web_name_placeholder')}
              />
              {form.name !== '' && invalidName && (
                <p className="text-xs text-pwc-danger">
                  {localize('com_ui_tars_db_name_invalid', {
                    0: String(NAME_MIN),
                    1: String(NAME_MAX),
                  })}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-web-url">
                {localize('com_ui_tars_web_url')}
                {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
              </Label>
              {isEdit ? (
                <p className="flex items-center gap-1.5 break-all rounded-md border border-border-light px-3 py-2 text-sm text-text-secondary">
                  {form.url}
                </p>
              ) : (
                <Input
                  id="tars-web-url"
                  value={form.url}
                  onChange={(event) => set('url', event.target.value)}
                  placeholder="https://example.com/docs"
                />
              )}
              <p className="text-xs text-text-secondary">
                {localize(isEdit ? 'com_ui_tars_web_url_locked' : 'com_ui_tars_web_url_hint')}
              </p>
              {form.url !== '' && !invalidUrl && (
                <a
                  href={form.url.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary hover:underline"
                >
                  {localize('com_ui_tars_web_preview')}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-web-description">{localize('com_ui_description')}</Label>
              <Input
                id="tars-web-description"
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </div>

            {!isEdit && (
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-web-enabled">{localize('com_ui_tars_db_enabled')}</Label>
                <Switch
                  id="tars-web-enabled"
                  aria-label={localize('com_ui_tars_db_enabled')}
                  checked={form.enabled}
                  onCheckedChange={(checked) => set('enabled', checked)}
                />
              </div>
            )}

            {!isEdit && (
              <p className="rounded-lg border border-border-light p-3 text-xs text-text-secondary">
                {localize('com_ui_tars_web_import_notice')}
              </p>
            )}

            {isBusy && importsAny && (
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <Spinner className="size-4" />
                {localize('com_ui_tars_web_importing')}
              </p>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canSave}>
            {isBusy ? (
              <Spinner className="size-4" />
            ) : (
              localize(isEdit ? 'com_ui_save' : 'com_ui_tars_web_import')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
