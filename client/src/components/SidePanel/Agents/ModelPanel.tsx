import React, { useMemo, useEffect, useRef, useState } from 'react';
import keyBy from 'lodash/keyBy';
import { ControlCombobox } from '@librechat/client';
import { useFormContext, useWatch } from 'react-hook-form';
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
import type { AgentForm, StringOption } from '~/common';
import ParametersFields from '~/components/SidePanel/Parameters/Fields';
import ParametersModal from '~/components/SidePanel/Parameters/Modal';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLiveAnnouncer } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ModelPanel({
  open,
  onClose,
  providers,
  modelsByProvider,
}: {
  open: boolean;
  onClose: () => void;
  providers: StringOption[];
  modelsByProvider: Record<string, string[]>;
}) {
  const localize = useLocalize();
  const { announcePolite } = useLiveAnnouncer();

  const { control, setValue } = useFormContext<AgentForm>();

  const currentProvider = useWatch({ control, name: 'provider' });
  const currentModel = useWatch({ control, name: 'model' });
  const currentModelParameters = useWatch({
    control,
    name: 'model_parameters',
  });

  const [tempProvider, setTempProvider] = useState<string>('');
  const [tempModel, setTempModel] = useState<string>('');
  const [tempModelParameters, setTempModelParameters] = useState<t.AgentModelParameters>(
    {} as t.AgentModelParameters,
  );

  const initializedRef = useRef(false);

  useEffect(() => {
    if (open && !initializedRef.current) {
      const providerValue =
        typeof currentProvider === 'string'
          ? currentProvider
          : ((currentProvider as StringOption | undefined)?.value ?? '');

      setTempProvider(providerValue);
      setTempModel(currentModel ?? '');
      setTempModelParameters(currentModelParameters ?? ({} as t.AgentModelParameters));

      initializedRef.current = true;
    }

    if (!open) {
      initializedRef.current = false;
    }
  }, [open, currentProvider, currentModel, currentModelParameters]);

  const models = useMemo(
    () => modelsByProvider[tempProvider] ?? [],
    [modelsByProvider, tempProvider],
  );

  useEffect(() => {
    if (!tempProvider) {
      return;
    }

    if (!tempModel || !models.includes(tempModel)) {
      setTempModel(models[0] ?? '');
    }
  }, [tempProvider, models, tempModel]);
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();

  const bedrockRegions = useMemo(() => {
    return endpointsConfig?.[tempProvider]?.availableRegions ?? [];
  }, [endpointsConfig, tempProvider]);

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, tempProvider, 'type'),
    [tempProvider, endpointsConfig],
  );

  const parameters = useMemo((): SettingDefinition[] => {
    const customParams = endpointsConfig[tempProvider]?.customParams ?? {};

    const [combinedKey, endpointKey] = getSettingsKeys(
      endpointType ?? tempProvider,
      tempModel ?? '',
    );

    const overriddenEndpointKey = customParams.defaultParamsEndpoint ?? endpointKey;

    const defaultParams =
      agentParamSettings[combinedKey] ?? agentParamSettings[overriddenEndpointKey] ?? [];

    const overriddenParams = endpointsConfig[tempProvider]?.customParams?.paramDefinitions ?? [];

    const overriddenParamsMap = keyBy(overriddenParams, 'key');

    const modelAwareParams = applyModelAwareDefaults(
      defaultParams.filter((param) => param != null),
      overriddenEndpointKey,
      tempModel ?? '',
    );

    return modelAwareParams.map(
      (param) => (overriddenParamsMap[param.key] as SettingDefinition) ?? param,
    );
  }, [endpointType, endpointsConfig, tempModel, tempProvider]);

  const setOption = (optionKey: keyof t.AgentModelParameters) => (value: t.AgentParameterValue) => {
    setTempModelParameters((prev) => ({
      ...prev,
      [optionKey]: value,
    }));
  };

  const handleProviderChange = (value: string | StringOption) => {
    const providerValue = typeof value === 'string' ? value : (value.value ?? '');

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

    localStorage.setItem(LocalStorageKeys.LAST_AGENT_MODEL, tempModel);
    localStorage.setItem(LocalStorageKeys.LAST_AGENT_PROVIDER, tempProvider);

    initializedRef.current = false;
    onClose();
  };

  return (
    <ParametersModal
      open={open}
      title={localize('com_ui_model_parameters')}
      titleId="agent-model-modal-title"
      onClose={handleCancel}
      onConfirm={handleConfirm}
      confirmDisabled={!tempProvider || !tempModel}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-1">
          <label
            id="provider-label"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
            htmlFor="provider"
          >
            {localize('com_ui_provider')} <span className="text-red-500">*</span>
          </label>

          <ControlCombobox
            selectedValue={tempProvider}
            displayValue={alternateName[tempProvider] ?? tempProvider}
            selectPlaceholder={localize('com_ui_select_provider')}
            searchPlaceholder={localize('com_ui_select_search_provider')}
            setValue={handleProviderChange}
            items={providers.map((provider) => ({
              label: typeof provider === 'string' ? provider : provider.label,
              value: typeof provider === 'string' ? provider : provider.value,
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
            {localize('com_ui_model')} <span className="text-red-500">*</span>
          </label>

          <ControlCombobox
            selectedValue={tempModel}
            selectPlaceholder={localize('com_ui_select_model')}
            searchPlaceholder={localize('com_ui_select_model')}
            setValue={setTempModel}
            items={models.map((modelItem) => ({
              label: modelItem,
              value: modelItem,
            }))}
            ariaLabel={localize('com_ui_model')}
            isCollapsed={false}
            showCarat={true}
          />
        </div>
      </div>

      <ParametersFields
        parameters={parameters}
        values={tempModelParameters as Partial<t.TConversation>}
        setOption={setOption as t.TSetOption}
        onReset={handleResetParameters}
        bedrockRegions={bedrockRegions}
      />
    </ParametersModal>
  );
}
