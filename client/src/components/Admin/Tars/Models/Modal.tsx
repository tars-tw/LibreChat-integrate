import { useMemo, useState } from 'react';
import { isTarsModelType, TARS_MODEL_TYPES, isTarsModelEndpoint } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Spinner,
  Dropdown,
  Textarea,
  OGDialog,
  OGDialogTemplate,
} from '@librechat/client';
import type {
  TTarsModelType,
  TTarsModelProfile,
  TTarsModelProfileInput,
} from 'librechat-data-provider';
import type { ClipboardEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import {
  useCreateTarsModelProfileMutation,
  useUpdateTarsModelProfileMutation,
} from '~/data-provider';
import { formatConfig, isValidConfig, joinDescription, splitDescription } from './helpers';
import useFeedback from './useFeedback';
import { useLocalize } from '~/hooks';

/** `Dropdown` shows an empty trigger for '', so "nothing chosen" needs a real option value. */
const NO_SOURCE = 'none';
const NO_TYPE = 'none';

const TYPE_LABELS: Record<TTarsModelType, TranslationKeys> = {
  CLOUD: 'com_ui_tars_models_type_cloud',
  VLLM: 'com_ui_tars_models_type_vllm',
  GOOGLE_VERTEX: 'com_ui_tars_models_type_google_vertex',
};

type FormState = {
  name: string;
  type: string;
  version: string;
  endpoint: string;
  apiVersion: string;
  descriptionZh: string;
  descriptionEn: string;
  config: string;
};

type FieldErrors = Partial<Record<'name' | 'type' | 'endpoint' | 'config', TranslationKeys>>;

const toFormState = (profile?: TTarsModelProfile): FormState => {
  const description = splitDescription(profile?.description);
  return {
    name: profile?.name ?? '',
    type: profile?.type ?? '',
    version: profile?.version ?? '',
    endpoint: profile?.endpoint ?? '',
    apiVersion: profile?.api_version ?? '',
    descriptionZh: description.zh,
    descriptionEn: description.en,
    config: formatConfig(profile?.config ?? ''),
  };
};

/** The fields saved as typed; the description is handled on its own. */
const toFields = (state: FormState) => ({
  name: state.name.trim(),
  type: state.type.trim(),
  version: state.version.trim(),
  endpoint: state.endpoint.trim(),
  apiVersion: state.apiVersion.trim(),
  config: state.config.trim(),
});

function FieldError({ messageKey }: { messageKey?: TranslationKeys }) {
  const localize = useLocalize();
  if (!messageKey) {
    return null;
  }
  return <p className="mt-1 text-xs text-text-destructive">{localize(messageKey)}</p>;
}

export default function ModelProfileModal({
  profile,
  profiles,
  onOpenChange,
}: {
  /** Absent when creating. */
  profile?: TTarsModelProfile;
  /** Every profile, for the copy source and the duplicate-name check. */
  profiles: TTarsModelProfile[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { notifySuccess, notifyError } = useFeedback();
  const isEdit = profile != null;
  const initial = useMemo(() => toFormState(profile), [profile]);

  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [copySource, setCopySource] = useState(NO_SOURCE);

  const createMutation = useCreateTarsModelProfileMutation({
    onSuccess: () => {
      notifySuccess(localize('com_ui_tars_models_created'));
      onOpenChange(false);
    },
    onError: notifyError,
  });
  const updateMutation = useUpdateTarsModelProfileMutation({
    onSuccess: ({ sync }) => {
      notifySuccess(localize('com_ui_tars_models_updated'), sync);
      onOpenChange(false);
    },
    onError: notifyError,
  });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const sourceOptions = useMemo(
    () => [
      { value: NO_SOURCE, label: localize('com_ui_tars_models_copy_none') },
      ...profiles.map((item) => ({ value: item.id, label: item.name })),
    ],
    [profiles, localize],
  );

  /** A row still carrying a pre-normalisation type keeps it on offer until another is picked. */
  const typeOptions = useMemo(() => {
    const legacy = initial.type.trim();
    return [
      ...(form.type ? [] : [{ value: NO_TYPE, label: localize('com_ui_tars_models_type_select') }]),
      ...TARS_MODEL_TYPES.map((type) => ({ value: type, label: localize(TYPE_LABELS[type]) })),
      ...(legacy && !isTarsModelType(legacy)
        ? [{ value: legacy, label: localize('com_ui_tars_models_type_legacy', { type: legacy }) }]
        : []),
    ];
  }, [form.type, initial.type, localize]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  /** Settings come across as-is; type and endpoint only fill fields still left blank. */
  const handleCopy = (sourceId: string) => {
    setCopySource(sourceId);
    const source = profiles.find((item) => item.id === sourceId);
    if (!source) {
      return;
    }
    const copiedType = isTarsModelType(source.type) ? source.type : '';
    setForm((prev) => ({
      ...prev,
      config: formatConfig(source.config ?? ''),
      apiVersion: source.api_version ?? '',
      type: prev.type || copiedType,
      endpoint: prev.endpoint.trim() ? prev.endpoint : (source.endpoint ?? ''),
    }));
    setErrors({});
  };

  const handleEndpointBlur = () => {
    if (form.endpoint.trim() && !isTarsModelEndpoint(form.endpoint)) {
      setErrors((prev) => ({ ...prev, endpoint: 'com_ui_tars_models_endpoint_invalid' }));
    }
  };

  /**
   * A config pasted as one JSON line is laid out with indentation right away so
   * its keys can be read; anything that is not yet a whole JSON object pastes
   * as typed.
   */
  const handleConfigPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart, selectionEnd } = event.currentTarget;
    const next =
      value.slice(0, selectionStart) +
      event.clipboardData.getData('text') +
      value.slice(selectionEnd);
    if (!next.trim() || !isValidConfig(next)) {
      return;
    }
    event.preventDefault();
    update('config', formatConfig(next));
  };

  const handleConfigBlur = () => {
    if (!isValidConfig(form.config)) {
      setErrors((prev) => ({ ...prev, config: 'com_ui_tars_models_config_invalid' }));
      return;
    }
    update('config', formatConfig(form.config));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const name = form.name.trim();
    if (!name) {
      next.name = 'com_ui_tars_models_required';
    } else if (
      name.toLowerCase() !== (profile?.name ?? '').trim().toLowerCase() &&
      profiles.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())
    ) {
      next.name = 'com_ui_tars_models_name_taken';
    }
    if (!form.type.trim()) {
      next.type = 'com_ui_tars_models_required';
    }
    if (!form.endpoint.trim()) {
      next.endpoint = 'com_ui_tars_models_required';
    } else if (!isTarsModelEndpoint(form.endpoint)) {
      next.endpoint = 'com_ui_tars_models_endpoint_invalid';
    }
    if (!isValidConfig(form.config)) {
      next.config = 'com_ui_tars_models_config_invalid';
    }
    return next;
  };

  const handleSave = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const fields = toFields(form);
    const description = joinDescription(
      profile?.description,
      form.descriptionZh,
      form.descriptionEn,
    );
    if (!isEdit) {
      createMutation.mutate({ ...fields, description });
      return;
    }

    /**
     * Only what changed is sent: pwc_tars keeps omitted fields, so an untouched
     * legacy plain-text description is not rewritten as JSON and an untouched
     * config keeps its stored formatting.
     */
    const baseline = toFields(initial);
    const changes: TTarsModelProfileInput = {};
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      if (fields[key] !== baseline[key]) {
        changes[key] = fields[key];
      }
    }
    if (
      form.descriptionZh !== initial.descriptionZh ||
      form.descriptionEn !== initial.descriptionEn
    ) {
      changes.description = description;
    }
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    updateMutation.mutate({ id: profile.id, data: changes });
  };

  const renamed = isEdit && form.name.trim() !== '' && form.name.trim() !== profile.name;

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_models_edit') : localize('com_ui_tars_models_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1">
            {isEdit && (
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_models_id')}:{' '}
                <span className="select-all break-all font-mono">{profile.id}</span>
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="tars-model-name">{localize('com_ui_tars_models_name')} *</Label>
                <Input
                  id="tars-model-name"
                  className="mt-1 placeholder:text-text-muted"
                  value={form.name}
                  autoComplete="off"
                  aria-invalid={errors.name != null}
                  placeholder={localize('com_ui_tars_models_name_placeholder')}
                  onChange={(e) => update('name', e.target.value)}
                />
                <FieldError messageKey={errors.name} />
                {renamed && errors.name == null && (
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_tars_models_rename_hint')}
                  </p>
                )}
              </div>
              <div>
                <Label id="tars-model-type-label">{localize('com_ui_tars_models_type')} *</Label>
                <Dropdown
                  value={form.type || NO_TYPE}
                  options={typeOptions}
                  onChange={(value) => update('type', value === NO_TYPE ? '' : value)}
                  variant="field"
                  aria-labelledby="tars-model-type-label"
                  className="mt-1"
                />
                <FieldError messageKey={errors.type} />
              </div>
              <div>
                <Label htmlFor="tars-model-version">{localize('com_ui_tars_models_version')}</Label>
                <Input
                  id="tars-model-version"
                  className="mt-1 placeholder:text-text-muted"
                  value={form.version}
                  autoComplete="off"
                  placeholder={localize('com_ui_tars_models_version_placeholder')}
                  onChange={(e) => update('version', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tars-model-api-version">
                  {localize('com_ui_tars_models_api_version')}
                </Label>
                <Input
                  id="tars-model-api-version"
                  className="mt-1 font-mono placeholder:text-text-muted"
                  value={form.apiVersion}
                  autoComplete="off"
                  placeholder={localize('com_ui_tars_models_api_version_placeholder')}
                  onChange={(e) => update('apiVersion', e.target.value)}
                />
                <p className="mt-1 text-xs text-text-secondary">
                  {localize('com_ui_tars_models_api_version_hint')}
                </p>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="tars-model-endpoint">
                  {localize('com_ui_tars_models_endpoint')} *
                </Label>
                <Input
                  id="tars-model-endpoint"
                  className="mt-1 font-mono placeholder:text-text-muted"
                  value={form.endpoint}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errors.endpoint != null}
                  onBlur={handleEndpointBlur}
                  placeholder={localize('com_ui_tars_models_endpoint_placeholder')}
                  onChange={(e) => update('endpoint', e.target.value)}
                />
                <FieldError messageKey={errors.endpoint} />
              </div>
            </div>

            <div>
              <p className="text-sm text-text-primary">
                {localize('com_ui_tars_models_description')}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_tars_models_description_hint')}
              </p>
              <div className="mt-2 grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="tars-model-description-zh" className="text-xs">
                    {localize('com_ui_tars_models_description_zh')}
                  </Label>
                  <Textarea
                    id="tars-model-description-zh"
                    rows={2}
                    className="mt-1"
                    value={form.descriptionZh}
                    onChange={(e) => update('descriptionZh', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tars-model-description-en" className="text-xs">
                    {localize('com_ui_tars_models_description_en')}
                  </Label>
                  <Textarea
                    id="tars-model-description-en"
                    rows={2}
                    className="mt-1"
                    value={form.descriptionEn}
                    onChange={(e) => update('descriptionEn', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="tars-model-config">{localize('com_ui_tars_models_config')}</Label>
              <p className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_tars_models_config_hint')}
              </p>
              {!isEdit && profiles.length > 0 && (
                <div className="mt-2">
                  <Label id="tars-model-copy-label" className="text-xs">
                    {localize('com_ui_tars_models_copy_from')}
                  </Label>
                  <Dropdown
                    value={copySource}
                    options={sourceOptions}
                    onChange={handleCopy}
                    searchable={true}
                    variant="field"
                    aria-labelledby="tars-model-copy-label"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_tars_models_copy_from_hint')}
                  </p>
                </div>
              )}
              <Textarea
                id="tars-model-config"
                rows={12}
                spellCheck={false}
                className="mt-2 resize-y font-mono text-xs placeholder:text-text-muted"
                value={form.config}
                aria-invalid={errors.config != null}
                placeholder={localize('com_ui_tars_models_config_placeholder')}
                onChange={(e) => update('config', e.target.value)}
                onPaste={handleConfigPaste}
                onBlur={handleConfigBlur}
              />
              <FieldError messageKey={errors.config} />
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
