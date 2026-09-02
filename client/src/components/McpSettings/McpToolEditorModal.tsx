import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Label,
  Input,
  Button,
  Switch,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
} from '@librechat/client';
import { useLocalize } from '~/hooks';

export type ParamLocation = 'path' | 'query' | 'header' | 'cookie';

export interface ParamDraft {
  name: string;
  in: ParamLocation;
  type: string;
  required: boolean;
  description: string;
}

export interface BodyPropertyDraft {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolDraft {
  name: string;
  description: string;
  method: string;
  path: string;
  parameters: ParamDraft[];
  bodyContentType: string;
  bodyWrap: string;
  bodyProperties: BodyPropertyDraft[];
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const PARAM_TYPES = ['string', 'integer', 'number', 'boolean', 'array', 'object'];
const BODY_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];
const PARAM_LOCATIONS: ParamLocation[] = ['path', 'query', 'header', 'cookie'];
const TOOL_NAME_RE = /^[A-Za-z0-9_-]+$/;

const isParamLocation = (value: unknown): value is ParamLocation =>
  PARAM_LOCATIONS.includes(value as ParamLocation);

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export const emptyToolDraft = (): ToolDraft => ({
  name: '',
  description: '',
  method: 'GET',
  path: '',
  parameters: [],
  bodyContentType: 'application/json',
  bodyWrap: '',
  bodyProperties: [],
});

/** Reads a raw `connection_config.tools[]` entry (pwc_tars's stored shape) into editable form state. */
export function toToolDraft(raw: unknown): ToolDraft {
  const tool = asRecord(raw);
  const requestBody = tool.request_body != null ? asRecord(tool.request_body) : null;
  const parameters = Array.isArray(tool.parameters)
    ? tool.parameters.map((param) => {
        const p = asRecord(param);
        const schema = asRecord(p.schema);
        return {
          name: String(p.name ?? ''),
          in: isParamLocation(p.in) ? p.in : 'query',
          type: String(schema.type ?? 'string'),
          required: Boolean(p.required),
          description: String(p.description ?? schema.description ?? ''),
        };
      })
    : [];
  const bodyProperties = Array.isArray(requestBody?.properties)
    ? (requestBody.properties as unknown[]).map((prop) => {
        const p = asRecord(prop);
        return {
          name: String(p.name ?? ''),
          type: String(p.type ?? 'string'),
          required: Boolean(p.required),
          description: String(p.description ?? ''),
        };
      })
    : [];
  return {
    name: String(tool.name ?? ''),
    description: String(tool.description ?? ''),
    method: String(tool.method ?? 'GET').toUpperCase(),
    path: String(tool.path ?? ''),
    parameters,
    bodyContentType: String(requestBody?.content_type ?? 'application/json'),
    bodyWrap: String(requestBody?.wrap ?? ''),
    bodyProperties,
  };
}

/** Converts form state back into the raw shape pwc_tars's custom_api executor expects. */
export function toolDraftToStored(draft: ToolDraft): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    name: draft.name.trim(),
    method: draft.method,
    path: draft.path.trim(),
    parameters: draft.parameters.map((param) => ({
      name: param.name.trim(),
      in: param.in,
      required: param.required,
      ...(param.description.trim() ? { description: param.description.trim() } : {}),
      schema: { type: param.type },
    })),
  };
  if (draft.description.trim()) {
    stored.description = draft.description.trim();
  }
  if (draft.method !== 'GET' && draft.bodyProperties.length > 0) {
    stored.request_body = {
      content_type: draft.bodyContentType,
      ...(draft.bodyWrap.trim() ? { wrap: draft.bodyWrap.trim() } : {}),
      properties: draft.bodyProperties.map((prop) => ({
        name: prop.name.trim(),
        type: prop.type,
        required: prop.required,
        ...(prop.description.trim() ? { description: prop.description.trim() } : {}),
      })),
    };
  }
  return stored;
}

type ToolValidationError =
  | 'com_ui_tars_mcp_tool_name_required'
  | 'com_ui_tars_mcp_tool_name_invalid'
  | 'com_ui_tars_mcp_tool_name_duplicate'
  | 'com_ui_tars_mcp_tool_path_required';

export function validateToolDraft(
  draft: ToolDraft,
  otherNames: Set<string>,
): ToolValidationError | null {
  const name = draft.name.trim();
  if (!name) {
    return 'com_ui_tars_mcp_tool_name_required';
  }
  if (!TOOL_NAME_RE.test(name)) {
    return 'com_ui_tars_mcp_tool_name_invalid';
  }
  if (otherNames.has(name)) {
    return 'com_ui_tars_mcp_tool_name_duplicate';
  }
  if (!draft.path.trim().startsWith('/')) {
    return 'com_ui_tars_mcp_tool_path_required';
  }
  return null;
}

const PARAM_ROW = 'grid grid-cols-[1fr_6.5rem_6.5rem_3.5rem_1fr_2rem] items-center gap-2';
const BODY_ROW = 'grid grid-cols-[1fr_6.5rem_3.5rem_1fr_2rem] items-center gap-2';

export default function McpToolEditorModal({
  isEdit,
  draft: initialDraft,
  otherNames,
  onSave,
  onOpenChange,
}: {
  isEdit: boolean;
  draft: ToolDraft;
  otherNames: Set<string>;
  onSave: (draft: ToolDraft) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [draft, setDraft] = useState<ToolDraft>(initialDraft);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const updateParam = (index: number, patch: Partial<ParamDraft>) =>
    setDraft((prev) => ({
      ...prev,
      parameters: prev.parameters.map((param, i) => (i === index ? { ...param, ...patch } : param)),
    }));
  const addParam = () =>
    setDraft((prev) => ({
      ...prev,
      parameters: [
        ...prev.parameters,
        { name: '', in: 'query', type: 'string', required: false, description: '' },
      ],
    }));
  const removeParam = (index: number) =>
    setDraft((prev) => ({ ...prev, parameters: prev.parameters.filter((_, i) => i !== index) }));

  const updateBodyProp = (index: number, patch: Partial<BodyPropertyDraft>) =>
    setDraft((prev) => ({
      ...prev,
      bodyProperties: prev.bodyProperties.map((prop, i) =>
        i === index ? { ...prop, ...patch } : prop,
      ),
    }));
  const addBodyProp = () =>
    setDraft((prev) => ({
      ...prev,
      bodyProperties: [
        ...prev.bodyProperties,
        { name: '', type: 'string', required: false, description: '' },
      ],
    }));
  const removeBodyProp = (index: number) =>
    setDraft((prev) => ({
      ...prev,
      bodyProperties: prev.bodyProperties.filter((_, i) => i !== index),
    }));

  const handleSave = () => {
    const validationError = validateToolDraft(draft, otherNames);
    if (validationError) {
      setError(localize(validationError));
      return;
    }
    onSave(draft);
  };

  const showBody = draft.method !== 'GET';

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_ui_tars_mcp_tool_edit' : 'com_ui_tars_mcp_tool_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {error != null && <p className="text-sm text-red-500">{error}</p>}

            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <div>
                <Label htmlFor="tars-mcp-tool-name">{localize('com_ui_name')}</Label>
                <Input
                  id="tars-mcp-tool-name"
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="create_issue"
                />
              </div>
              <div>
                <Label>{localize('com_ui_tars_mcp_tool_method')}</Label>
                <Dropdown
                  value={draft.method}
                  onChange={(value) => set('method', value)}
                  ariaLabel={localize('com_ui_tars_mcp_tool_method')}
                  options={HTTP_METHODS}
                  sizeClasses="w-full"
                  className="w-full"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="tars-mcp-tool-path">{localize('com_ui_tars_mcp_tool_path')}</Label>
              <Input
                id="tars-mcp-tool-path"
                value={draft.path}
                onChange={(e) => set('path', e.target.value)}
                placeholder="/issues/{id}"
              />
              <p className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_tars_mcp_tool_path_hint')}
              </p>
            </div>

            <div>
              <Label htmlFor="tars-mcp-tool-desc">{localize('com_ui_description')}</Label>
              <Input
                id="tars-mcp-tool-desc"
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border-light p-3">
              <div className="flex items-center justify-between">
                <Label>{localize('com_ui_tars_mcp_params')}</Label>
                <Button variant="outline" onClick={addParam}>
                  <Plus className="icon-sm mr-1" />
                  {localize('com_ui_tars_mcp_param_add')}
                </Button>
              </div>
              {draft.parameters.length > 0 && (
                <div className="space-y-2">
                  <div className={`${PARAM_ROW} text-xs font-medium text-text-secondary`}>
                    <span>{localize('com_ui_name')}</span>
                    <span>{localize('com_ui_tars_mcp_param_location')}</span>
                    <span>{localize('com_ui_tars_mcp_param_type')}</span>
                    <span>{localize('com_ui_tars_mcp_param_required')}</span>
                    <span>{localize('com_ui_description')}</span>
                    <span />
                  </div>
                  {draft.parameters.map((param, index) => (
                    <div key={index} className={PARAM_ROW}>
                      <Input
                        value={param.name}
                        onChange={(e) => updateParam(index, { name: e.target.value })}
                        aria-label={localize('com_ui_name')}
                      />
                      <Dropdown
                        value={param.in}
                        onChange={(value) => updateParam(index, { in: value as ParamLocation })}
                        ariaLabel={localize('com_ui_tars_mcp_param_location')}
                        options={[
                          { value: 'path', label: localize('com_ui_tars_mcp_param_in_path') },
                          { value: 'query', label: localize('com_ui_tars_mcp_param_in_query') },
                          { value: 'header', label: localize('com_ui_tars_mcp_param_in_header') },
                          { value: 'cookie', label: localize('com_ui_tars_mcp_param_in_cookie') },
                        ]}
                        sizeClasses="w-full"
                        className="w-full"
                      />
                      <Dropdown
                        value={param.type}
                        onChange={(value) => updateParam(index, { type: value })}
                        ariaLabel={localize('com_ui_tars_mcp_param_type')}
                        options={PARAM_TYPES}
                        sizeClasses="w-full"
                        className="w-full"
                      />
                      <Switch
                        aria-label={localize('com_ui_tars_mcp_param_required')}
                        checked={param.required}
                        onCheckedChange={(checked) => updateParam(index, { required: checked })}
                      />
                      <Input
                        value={param.description}
                        onChange={(e) => updateParam(index, { description: e.target.value })}
                        aria-label={localize('com_ui_description')}
                      />
                      <button
                        type="button"
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        onClick={() => removeParam(index)}
                        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                      >
                        <Trash2 className="icon-sm" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showBody && (
              <div className="space-y-3 rounded-lg border border-border-light p-3">
                <div className="flex items-center justify-between">
                  <Label>{localize('com_ui_tars_mcp_body')}</Label>
                  <Button variant="outline" onClick={addBodyProp}>
                    <Plus className="icon-sm mr-1" />
                    {localize('com_ui_tars_mcp_body_add_property')}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{localize('com_ui_tars_mcp_body_content_type')}</Label>
                    <Dropdown
                      value={draft.bodyContentType}
                      onChange={(value) => set('bodyContentType', value)}
                      ariaLabel={localize('com_ui_tars_mcp_body_content_type')}
                      options={BODY_CONTENT_TYPES}
                      sizeClasses="w-full"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <Label htmlFor="tars-mcp-tool-body-wrap">
                      {localize('com_ui_tars_mcp_body_wrap')}
                    </Label>
                    <Input
                      id="tars-mcp-tool-body-wrap"
                      value={draft.bodyWrap}
                      onChange={(e) => set('bodyWrap', e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_tars_mcp_body_wrap_hint')}
                </p>
                {draft.bodyProperties.length > 0 && (
                  <div className="space-y-2">
                    <div className={`${BODY_ROW} text-xs font-medium text-text-secondary`}>
                      <span>{localize('com_ui_name')}</span>
                      <span>{localize('com_ui_tars_mcp_param_type')}</span>
                      <span>{localize('com_ui_tars_mcp_param_required')}</span>
                      <span>{localize('com_ui_description')}</span>
                      <span />
                    </div>
                    {draft.bodyProperties.map((prop, index) => (
                      <div key={index} className={BODY_ROW}>
                        <Input
                          value={prop.name}
                          onChange={(e) => updateBodyProp(index, { name: e.target.value })}
                          aria-label={localize('com_ui_name')}
                        />
                        <Dropdown
                          value={prop.type}
                          onChange={(value) => updateBodyProp(index, { type: value })}
                          ariaLabel={localize('com_ui_tars_mcp_param_type')}
                          options={PARAM_TYPES}
                          sizeClasses="w-full"
                          className="w-full"
                        />
                        <Switch
                          aria-label={localize('com_ui_tars_mcp_param_required')}
                          checked={prop.required}
                          onCheckedChange={(checked) =>
                            updateBodyProp(index, { required: checked })
                          }
                        />
                        <Input
                          value={prop.description}
                          onChange={(e) => updateBodyProp(index, { description: e.target.value })}
                          aria-label={localize('com_ui_description')}
                        />
                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          title={localize('com_ui_delete')}
                          onClick={() => removeBodyProp(index)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                        >
                          <Trash2 className="icon-sm" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave}>
            {localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
