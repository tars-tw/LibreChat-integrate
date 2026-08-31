import { useState } from 'react';
import { Input, Label } from '@librechat/client';
import { Controller, useWatch, useFormContext } from 'react-hook-form';
import type { AgentForm, StringOption } from '~/common';
import { ResolvedProviderIcon } from '~/components/Endpoints/ResolvedProviderIcon';
import ModelPanel from './ModelPanel';
import { useLocalize, useAgentCapabilities } from '~/hooks';
import { useAgentFileEntries } from './Tools/hooks';
import { useAgentPanelContext } from '~/Providers';
import { useProviderIcon } from '~/hooks/Endpoint';
import ToolsSection from './Tools/ToolsSection';
import { validateEmail, cn } from '~/utils';
import Instructions from './Instructions';
import FileContext from './FileContext';
import AgentAvatar from './AgentAvatar';

const fieldClass = 'h-9';

interface AgentConfigProps {
  models: Record<string, string[]>;
  providers: StringOption[];
}

export default function AgentConfig({
  models,
  providers,
}: AgentConfigProps) {
  const localize = useLocalize();
  const methods = useFormContext<AgentForm>();
  const { endpointsConfig, agentsConfig } = useAgentPanelContext();
  const { contextEnabled } = useAgentCapabilities(agentsConfig?.capabilities);

  const {
    control,
    formState: { errors },
  } = methods;

  const provider = useWatch({ control, name: 'provider' });
  const model = useWatch({ control, name: 'model' });
  const agent = useWatch({ control, name: 'agent' });
  const agent_id = useWatch({ control, name: 'id' });
  const category = useWatch({ control, name: 'category' });
  const name = useWatch({ control, name: 'name' });
  const description = useWatch({ control, name: 'description' });
  const instructions = useWatch({ control, name: 'instructions' });
  const tools = useWatch({ control, name: 'tools' });
  const [showModelModal, setShowModelModal] = useState(false);

  const { contextFiles } = useAgentFileEntries();

  const step1Completed = Boolean(name?.trim() && !errors.name);

  const step2Completed = Boolean(typeof model === 'string' && model.trim());

  const showStep2 = step1Completed;
  const showStep3 = showStep2 && step2Completed;

  const providerValue = typeof provider === 'string' ? provider : provider?.value;
  const { provider: providerId, imageURL } = useProviderIcon({
    endpoint: providerValue as string,
    endpointsConfig,
  });

  return (
    <div className="h-auto pt-1">
      {/* IDENTITY — flat header, always visible, avatar inline */}
      <div className="mb-3 mt-1 flex items-center gap-3">
        <div className="flex-shrink-0">
          <AgentAvatar avatar={agent?.['avatar'] ?? null} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Controller
            name="name"
            rules={{ required: localize('com_ui_agent_name_is_required') }}
            control={control}
            render={({ field }) => (
              <div className="flex flex-col">
                <Input
                  {...field}
                  value={field.value ?? ''}
                  maxLength={256}
                  className={cn(fieldClass, 'font-medium')}
                  id="name"
                  type="text"
                  placeholder={localize('com_agents_name_placeholder')}
                  aria-label={localize('com_ui_agent_name')}
                  aria-invalid={!!errors.name}
                  aria-describedby={
                    errors.name ? 'agent-name-error' : undefined
                  }
                />

                {errors.name && (
                  <div
                    id="agent-name-error"
                    className="mt-1 text-xs text-red-500"
                    role="alert"
                  >
                    {errors.name.message}
                  </div>
                )}
              </div>
            )}
          />

          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                maxLength={512}
                className={fieldClass}
                id="description"
                type="text"
                placeholder={localize('com_agents_description_placeholder')}
                aria-label={localize('com_ui_agent_description')}
              />
            )}
          />
        </div>
      </div>

      {/* MODEL + CATEGORY — balanced 2-column grid */}
      {showStep2 && (
        <div className="mb-3 w-full">
          <div className="flex w-full min-w-0 flex-col">
            <Label
              className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
              htmlFor="provider"
            >
              {localize('com_ui_model')} <span className="text-red-500">*</span>
            </Label>

            <button
              id="provider"
              type="button"
              onClick={() => setShowModelModal(true)}
              title={model || undefined}
              className={cn(
                'relative flex h-9 w-full min-w-0 items-center overflow-hidden rounded-lg border border-border-light bg-surface-secondary text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
                model != null && model ? 'px-1' : 'px-3',
              )}
            >
              <div className="flex w-full min-w-0 items-center gap-2">
                {providerValue !== undefined && (
                  <div className="shadow-stroke relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-black dark:bg-white">
                    <ResolvedProviderIcon
                      provider={providerId}
                      imageURL={imageURL}
                      size={16}
                      className="h-2/3 w-2/3"
                    />
                  </div>
                )}

                <span className="truncate">
                  {model ? model : localize('com_ui_select_model')}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* INSTRUCTIONS */}
      {showStep2 && <Instructions />}

      {/* TOOLS — unified built-ins / tools / actions / mcp / skills */}
      {showStep3 && <ToolsSection agentId={agent_id} />}

      {/* FILE CONTEXT — standalone section, separate from the tool library */}
      {showStep3 && contextEnabled && (
        <div className="mb-3">
          <FileContext
            agent_id={agent_id}
            files={contextFiles}
          />
        </div>
      )}
      {/* SUPPORT CONTACT */}
      {/* <div className="mb-3 flex flex-col">
        <Label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          {localize('com_ui_support_contact')}
        </Label>
        <div className="space-y-2">
          <Controller
            name="support_contact.name"
            control={control}
            rules={{
              minLength: {
                value: 3,
                message: localize('com_ui_support_contact_name_min_length', { minLength: 3 }),
              },
            }}
            render={({ field, fieldState: { error } }) => (
              <div className="flex flex-col">
                <Input
                  {...field}
                  value={field.value ?? ''}
                  className={cn(fieldClass, error && 'border-2 border-red-500')}
                  id="support-contact-name"
                  type="text"
                  placeholder={localize('com_ui_support_contact_name_placeholder')}
                  aria-label={localize('com_ui_support_contact_name')}
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby={error ? 'support-contact-name-error' : undefined}
                />
                {error && (
                  <span
                    id="support-contact-name-error"
                    className="mt-1 text-xs text-red-500"
                    role="alert"
                    aria-live="polite"
                  >
                    {error.message}
                  </span>
                )}
              </div>
            )}
          />
          <Controller
            name="support_contact.email"
            control={control}
            rules={{
              validate: (value) =>
                validateEmail(value ?? '', localize('com_ui_support_contact_email_invalid')),
            }}
            render={({ field, fieldState: { error } }) => (
              <div className="flex flex-col">
                <Input
                  {...field}
                  value={field.value ?? ''}
                  className={cn(fieldClass, error && 'border-2 border-red-500')}
                  id="support-contact-email"
                  type="email"
                  placeholder={localize('com_ui_support_contact_email_placeholder')}
                  aria-label={localize('com_ui_support_contact_email')}
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby={error ? 'support-contact-email-error' : undefined}
                />
                {error && (
                  <span
                    id="support-contact-email-error"
                    className="mt-1 text-xs text-red-500"
                    role="alert"
                    aria-live="polite"
                  >
                    {error.message}
                  </span>
                )}
              </div>
            )}
          />
        </div>
      </div> */}
      <ModelPanel
        open={showModelModal}
        onClose={() => setShowModelModal(false)}
        models={models}
        providers={providers}
      />
    </div>
  );
}