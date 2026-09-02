import { useMemo, useState, useEffect, useCallback } from 'react';
import keyBy from 'lodash/keyBy';
import {
  excludedKeys,
  paramSettings,
  getSettingsKeys,
  getEndpointField,
  SettingDefinition,
  applyModelAwareDefaults,
} from 'librechat-data-provider';
import type { TConversation, TSetOption } from 'librechat-data-provider';
import ParametersFields from '~/components/SidePanel/Parameters/Fields';
import ParametersModal from '~/components/SidePanel/Parameters/Modal';
import { useChatContext, useLiveAnnouncer } from '~/Providers';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { logger } from '~/utils';

type ParameterValues = Partial<TConversation>;

/**
 * Per-conversation 模型參數, staged rather than live-applied: edits land in local state
 * and only reach the conversation on 確認, so 關閉 discards them.
 */
export default function ParametersDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { conversation, setConversation } = useChatContext();
  const { announcePolite } = useLiveAnnouncer();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();

  const [values, setValues] = useState<ParameterValues>({});

  const provider = conversation?.endpoint ?? '';
  const model = conversation?.model ?? '';

  const bedrockRegions = useMemo(
    () => endpointsConfig?.[provider]?.availableRegions ?? [],
    [endpointsConfig, provider],
  );

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, provider, 'type'),
    [endpointsConfig, provider],
  );

  const parameters = useMemo((): SettingDefinition[] => {
    const customParams = endpointsConfig[provider]?.customParams ?? {};
    const [combinedKey, endpointKey] = getSettingsKeys(endpointType ?? provider, model);
    const overriddenEndpointKey = customParams.defaultParamsEndpoint ?? endpointKey;
    const defaultParams = paramSettings[combinedKey] ?? paramSettings[overriddenEndpointKey] ?? [];
    const overriddenParams = endpointsConfig[provider]?.customParams?.paramDefinitions ?? [];
    const overriddenParamsMap = keyBy(overriddenParams, 'key');
    const modelAwareParams = applyModelAwareDefaults(
      defaultParams.filter((param) => param != null),
      overriddenEndpointKey,
      model,
    );
    return modelAwareParams.map(
      (param) => (overriddenParamsMap[param.key] as SettingDefinition) ?? param,
    );
  }, [endpointType, endpointsConfig, model, provider]);

  const paramKeys = useMemo(
    () => new Set(parameters.filter((setting) => setting != null).map((setting) => setting.key)),
    [parameters],
  );

  /** Seed once per opening so a re-render mid-edit cannot clobber staged values. */
  useEffect(() => {
    if (!open) {
      return;
    }

    const staged: ParameterValues = {};
    paramKeys.forEach((key) => {
      if (conversation?.[key] != null) {
        staged[key] = conversation[key];
      }
    });
    setValues(staged);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  const setOption = useCallback<TSetOption>(
    (optionKey) => (newValue) => {
      setValues((prev) => ({ ...prev, [optionKey]: newValue }));
    },
    [],
  );

  const handleReset = useCallback(() => {
    setValues({});
    announcePolite({ message: localize('com_ui_model_parameters_reset'), isStatus: true });
  }, [announcePolite, localize]);

  const handleConfirm = useCallback(() => {
    setConversation((prev) => {
      if (!prev) {
        return prev;
      }

      const updatedConversation = { ...prev };
      const updatedKeys: string[] = [];

      /** Drop params the current endpoint/model no longer defines, then write the staged
       *  ones — an absent staged value means the user reset it back to the default. */
      Object.keys(updatedConversation).forEach((key) => {
        if (paramKeys.has(key) || excludedKeys.has(key)) {
          return;
        }

        if (prev[key] != null) {
          updatedKeys.push(key);
          delete updatedConversation[key];
        }
      });

      paramKeys.forEach((key) => {
        const value = values[key];
        if (value === undefined) {
          if (updatedConversation[key] !== undefined) {
            updatedKeys.push(key);
            delete updatedConversation[key];
          }
          return;
        }

        if (updatedConversation[key] !== value) {
          updatedKeys.push(key);
          updatedConversation[key] = value;
        }
      });

      if (updatedKeys.length === 0) {
        return prev;
      }

      logger.log('parameters', 'parameters applied, updated keys:', updatedKeys);
      return updatedConversation;
    });

    onClose();
  }, [onClose, paramKeys, setConversation, values]);

  return (
    <ParametersModal
      open={open}
      title={localize('com_ui_model_parameters')}
      titleId="chat-model-parameters-title"
      onClose={onClose}
      onConfirm={handleConfirm}
    >
      <ParametersFields
        parameters={parameters}
        values={values}
        setOption={setOption}
        onReset={handleReset}
        bedrockRegions={bedrockRegions}
      />
    </ParametersModal>
  );
}
