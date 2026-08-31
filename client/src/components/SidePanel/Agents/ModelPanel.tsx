import React, { useMemo, useEffect, useRef, useState } from 'react';
import keyBy from 'lodash/keyBy';
import { RotateCcw, X } from 'lucide-react';
import { Button, ControlCombobox } from '@librechat/client';
import { useFormContext, useWatch, Controller } from 'react-hook-form';
import {
  alternateName,
  getSettingsKeys,
  getEndpointField,
  LocalStorageKeys,
  SettingDefinition,
  agentParamSettings,
  applyModelAwareDefaults,
} from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { AgentForm, AgentModelPanelProps, StringOption } from '~/common';
import { componentMapping } from '~/components/SidePanel/Parameters/components';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLiveAnnouncer } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ModelPanel({
  open,
  onClose,
  providers,
  models: modelsData,
}: Pick<AgentModelPanelProps, 'models' | 'providers'> & {
  open: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { announcePolite } = useLiveAnnouncer();

  const { control, setValue, getValues } = useFormContext<AgentForm>();

  const currentProvider = useWatch({ control, name: 'provider' });
  const currentModel = useWatch({ control, name: 'model' });
  const currentModelParameters = useWatch({
    control,
    name: 'model_parameters',
  });

  const [tempProvider, setTempProvider] = useState<string>('');
  const [tempModel, setTempModel] = useState<string>('');
  const [tempModelParameters, setTempModelParameters] = useState<
    t.AgentModelParameters
  >({} as t.AgentModelParameters);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (open && !initializedRef.current) {
      const providerValue =
        typeof currentProvider === 'string'
          ? currentProvider
          : (currentProvider as StringOption | undefined)?.value ?? '';

      setTempProvider(providerValue);
      setTempModel(currentModel ?? '');
      setTempModelParameters(
        currentModelParameters ?? ({} as t.AgentModelParameters),
      );

      initializedRef.current = true;
    }

    if (!open) {
      initializedRef.current = false;
    }
  }, [open]);

  const models = useMemo(
    () => (tempProvider ? (modelsData[tempProvider] ?? []) : []),
    [modelsData, tempProvider],
  );

  useEffect(() => {
    if (!open || !tempProvider) {
      return;
    }

    if (!tempModel || !models.includes(tempModel)) {
      setTempModel(models[0] ?? '');
    }
  }, [open, tempProvider, models, tempModel]);

  const { data: endpointsConfig = {} } = useGetEndpointsQuery();

  const bedrockRegions = useMemo(() => {
    return endpointsConfig?.[tempProvider]?.availableRegions ?? [];
  }, [endpointsConfig, tempProvider]);

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, tempProvider, 'type'),
    [tempProvider, endpointsConfig],
  );

  const parameters = useMemo((): SettingDefinition[] => {
    const customParams =
      endpointsConfig[tempProvider]?.customParams ?? {};

    const [combinedKey, endpointKey] = getSettingsKeys(
      endpointType ?? tempProvider,
      tempModel ?? '',
    );

    const overriddenEndpointKey =
      customParams.defaultParamsEndpoint ?? endpointKey;

    const defaultParams =
      agentParamSettings[combinedKey] ??
      agentParamSettings[overriddenEndpointKey] ??
      [];

    const overriddenParams =
      endpointsConfig[tempProvider]?.customParams?.paramDefinitions ?? [];

    const overriddenParamsMap = keyBy(overriddenParams, 'key');

    const modelAwareParams = applyModelAwareDefaults(
      defaultParams.filter((param) => param != null),
      overriddenEndpointKey,
      tempModel ?? '',
    );

    return modelAwareParams.map(
      (param) =>
        (overriddenParamsMap[param.key] as SettingDefinition) ?? param,
    );
  }, [
    endpointType,
    endpointsConfig,
    tempModel,
    tempProvider,
  ]);

  const setOption =
    (optionKey: keyof t.AgentModelParameters) =>
    (value: t.AgentParameterValue) => {
      setTempModelParameters((prev) => ({
        ...prev,
        [optionKey]: value,
      }));
    };

  const handleProviderChange = (value: string | StringOption) => {
    const providerValue =
      typeof value === 'string' ? value : value.value;

    setTempProvider(providerValue);
    setTempModel('');
    setTempModelParameters({} as t.AgentModelParameters);
  };

  const handleResetParameters = () => {
    setTempModelParameters({} as t.AgentModelParameters);

    announcePolite({
      message: localize('com_ui_model_parameters_reset'),
      isStatus: true,
    });
  };

  const handleCancel = () => {
    initializedRef.current = false;
    onClose();
  };

  const handleConfirm = () => {
    if (!tempProvider || !tempModel) {
      return;
    }

    setValue('provider', tempProvider, {
      shouldDirty: true,
      shouldValidate: true,
    });

    setValue('model', tempModel, {
      shouldDirty: true,
      shouldValidate: true,
    });

    setValue('model_parameters', tempModelParameters, {
      shouldDirty: true,
      shouldValidate: true,
    });

    localStorage.setItem(
      LocalStorageKeys.LAST_AGENT_MODEL,
      tempModel,
    );
    localStorage.setItem(
      LocalStorageKeys.LAST_AGENT_PROVIDER,
      tempProvider,
    );

    initializedRef.current = false;
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-model-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-primary shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border-light px-5 py-4">
          <h2
            id="agent-model-modal-title"
            className="text-base font-semibold text-text-primary"
          >
            {localize('com_ui_model_parameters')}
          </h2>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCancel}
            aria-label={localize('com_ui_close')}
            className="h-9 w-9 rounded-xl text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
          >
            <X
              className="h-5 w-5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="flex w-full flex-col gap-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="mb-1">
                <label
                  id="provider-label"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
                  htmlFor="provider"
                >
                  {localize('com_ui_provider')}{' '}
                  <span className="text-red-500">*</span>
                </label>

                <ControlCombobox
                  selectedValue={tempProvider}
                  displayValue={alternateName[tempProvider] ?? tempProvider}
                  selectPlaceholder={localize(
                    'com_ui_select_provider',
                  )}
                  searchPlaceholder={localize(
                    'com_ui_select_search_provider',
                  )}
                  setValue={handleProviderChange}
                  items={providers.map((provider) => ({
                    label:
                      typeof provider === 'string'
                        ? provider
                        : provider.label,
                    value:
                      typeof provider === 'string'
                        ? provider
                        : provider.value,
                  }))}
                  ariaLabel={localize('com_ui_provider')}
                  isCollapsed={false}
                  showCarat={true}
                />
              </div>

              <div className="mb-1">
                <label
                  id="model-label"
                  className={cn(
                    'mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary',
                    !tempProvider && 'opacity-60',
                  )}
                  htmlFor="model"
                >
                  {localize('com_ui_model')}{' '}
                  <span className="text-red-500">*</span>
                </label>

                <ControlCombobox
                  selectedValue={tempModel}
                  selectPlaceholder={
                    tempProvider
                      ? localize('com_ui_select_model')
                      : localize(
                          'com_ui_select_provider_first',
                        )
                  }
                  searchPlaceholder={localize(
                    'com_ui_select_model',
                  )}
                  setValue={(value) => {
                    setTempModel(
                      typeof value === 'string'
                        ? value
                        : value.value,
                    );
                  }}
                  items={models.map((modelItem) => ({
                    label: modelItem,
                    value: modelItem,
                  }))}
                  disabled={!tempProvider}
                  className="disabled:opacity-50"
                  ariaLabel={localize('com_ui_model')}
                  isCollapsed={false}
                  showCarat={true}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {parameters.map((setting) => {
                const Component =
                  componentMapping[setting.component];

                if (!Component) {
                  return null;
                }

                const {
                  key,
                  default: defaultValue,
                  ...rest
                } = setting;

                if (
                  key === 'region' &&
                  bedrockRegions.length
                ) {
                  rest.options = bedrockRegions;
                }

                return (
                  <div
                    key={key}
                    className={
                      key === 'maxContextTokens' || key === 'maxOutputTokens'
                        ? 'col-span-1'
                        : undefined
                    }
                  >
                    <Component
                      settingKey={key}
                      defaultValue={defaultValue}
                      {...rest}
                      setOption={setOption as t.TSetOption}
                      conversation={
                        tempModelParameters as Partial<t.TConversation>
                      }
                    />
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleResetParameters}
              className="mt-2 h-9 w-full rounded-xl px-4 font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
            >
              <RotateCcw
                className="h-4 w-4"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {localize('com_ui_reset_var', {
                0: localize(
                  'com_ui_model_parameters',
                ),
              })}
            </Button>
          </div>
        </div>

        <footer className="flex flex-shrink-0 justify-end gap-2 border-t border-border-light px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className="h-9 rounded-xl px-5"
          >
            {localize('com_ui_close')}
          </Button>

          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!tempProvider || !tempModel}
            className="h-9 rounded-xl px-5"
          >
            {localize('com_ui_confirm')}
          </Button>
        </footer>
      </div>
    </div>
  );
}