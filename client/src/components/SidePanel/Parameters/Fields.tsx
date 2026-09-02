import React from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@librechat/client';
import type { SettingDefinition } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import { componentMapping } from './components';
import { useLocalize } from '~/hooks';

/**
 * The two-column parameter grid plus its reset action, driven by whichever value bag
 * the caller owns — a conversation, or an agent's staged `model_parameters`.
 */
export default function ParametersFields({
  parameters,
  values,
  setOption,
  onReset,
  bedrockRegions = [],
}: {
  parameters: SettingDefinition[];
  values: Partial<t.TConversation>;
  setOption: t.TSetOption;
  onReset: () => void;
  bedrockRegions?: string[];
}) {
  const localize = useLocalize();

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {parameters.map((setting) => {
          const Component = componentMapping[setting.component];

          if (!Component) {
            return null;
          }

          const { key, default: defaultValue, ...rest } = setting;

          if (key === 'region' && bedrockRegions.length) {
            rest.options = bedrockRegions;
          }

          return (
            <div
              key={key}
              className={
                key === 'maxContextTokens' || key === 'maxOutputTokens' ? 'col-span-1' : undefined
              }
            >
              <Component
                settingKey={key}
                defaultValue={defaultValue}
                {...rest}
                setOption={setOption}
                conversation={values}
              />
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onReset}
        className="mt-2 h-9 w-full rounded-xl px-4 font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {localize('com_ui_reset_var', {
          0: localize('com_ui_model_parameters'),
        })}
      </Button>
    </>
  );
}
