import { useEffect, useMemo } from 'react';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller, FormProvider } from 'react-hook-form';
import {
  Input,
  Button,
  Spinner,
  useMediaQuery,
  useToastContext,
  TextareaAutosize,
} from '@librechat/client';
import type { TTarsPromptInput } from 'librechat-data-provider';
import { useCreateTarsPromptMutation, useUpdateTarsPromptMutation } from '~/data-provider';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import VariablesDropdown from '../editor/VariablesDropdown';
import PromptVariables from '../display/PromptVariables';
import CategorySelector from './CategorySelector';
import Description from '../fields/Description';
import Command from '../fields/Command';
import { useLocalize } from '~/hooks';
import useTarsPrompts from './hooks';
import { cn } from '~/utils';

type TarsPromptFormValues = {
  name: string;
  category: string;
  prompt: string;
  oneliner: string;
  command: string;
};

const emptyValues: TarsPromptFormValues = {
  name: '',
  category: '',
  prompt: '',
  oneliner: '',
  command: '',
};

/**
 * Create/edit form for a pwc_tars "我的提示". Everything is written through
 * `/api/tars/prompts` to the personal prompt tier; `command` is sent along for
 * the forthcoming pwc_tars column and is currently ignored by the backend.
 */
export default function TarsPromptForm({ promptId }: { promptId?: string }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { prompts, isLoading } = useTarsPrompts();

  const isEdit = promptId != null && promptId !== '';
  const prompt = useMemo(
    () => (isEdit ? prompts.find((item) => String(item.id) === promptId) : undefined),
    [isEdit, prompts, promptId],
  );

  const methods = useForm<TarsPromptFormValues>({ defaultValues: emptyValues });
  const {
    watch,
    reset,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isValid, isSubmitting },
  } = methods;

  useEffect(() => {
    if (!isEdit) {
      reset(emptyValues);
      return;
    }
    if (!prompt) {
      return;
    }
    reset({
      name: prompt.name,
      category: prompt.category ?? '',
      prompt: prompt.content,
      oneliner: prompt.description ?? '',
      command: '',
    });
  }, [isEdit, prompt, reset]);

  const createPrompt = useCreateTarsPromptMutation({
    onSuccess: (response) => {
      showToast({ status: 'success', message: localize('com_ui_prompt_saved') });
      navigate(`/prompts/${response.prompt.id}`, { replace: true });
    },
    onError: () => showToast({ status: 'error', message: localize('com_ui_prompt_save_error') }),
  });

  const updatePrompt = useUpdateTarsPromptMutation({
    onSuccess: () => showToast({ status: 'success', message: localize('com_ui_prompt_saved') }),
    onError: () => showToast({ status: 'error', message: localize('com_ui_prompt_update_error') }),
  });

  const promptText = watch('prompt');
  const category = watch('category');
  const isSaving = createPrompt.isLoading || updatePrompt.isLoading || isSubmitting;
  const submitLabel = isEdit ? localize('com_ui_update') : localize('com_ui_create_prompt');

  const onSubmit = (data: TarsPromptFormValues) => {
    const payload: TTarsPromptInput = {
      name: data.name.trim(),
      category: data.category.trim(),
      content: data.prompt,
      description: data.oneliner.trim(),
      command: data.command.trim(),
    };

    if (isEdit && promptId) {
      updatePrompt.mutate({ id: promptId, data: payload });
      return;
    }
    createPrompt.mutate(payload);
  };

  if (isEdit && !prompt) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        {isLoading ? (
          <Spinner />
        ) : (
          <p className="text-text-secondary">{localize('com_ui_nothing_found')}</p>
        )}
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)} className="w-full px-4 py-2">
        <h1 className="sr-only">
          {isEdit ? localize('com_ui_edit_prompt_page') : localize('com_ui_create_prompt_page')}
        </h1>
        {isSmallScreen ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <OpenSidebar />
            <CategorySelector
              value={category}
              onChange={(value) => setValue('category', value, { shouldDirty: true })}
            />
          </div>
        ) : null}
        <div className="mb-1 flex flex-col items-center justify-between font-bold sm:text-xl md:mb-0 md:text-2xl">
          <div className="flex w-full flex-col items-center justify-between sm:flex-row">
            <Controller
              name="name"
              control={control}
              rules={{ required: localize('com_ui_prompt_name_required') }}
              render={({ field }) => (
                <div className="relative mb-1 flex w-full flex-col sm:w-auto md:mb-0">
                  <Input
                    {...field}
                    id="prompt-name"
                    type="text"
                    className="peer mr-2 w-full border border-border-medium p-2 text-2xl text-text-primary"
                    placeholder=" "
                    tabIndex={0}
                    aria-label={localize('com_ui_prompt_name')}
                    aria-required="true"
                  />
                  <label
                    htmlFor="prompt-name"
                    className="pointer-events-none absolute -top-1 left-3 origin-[0] translate-y-3 scale-100 rounded bg-presentation px-1 text-base text-text-secondary transition-transform duration-200 peer-placeholder-shown:translate-y-3 peer-placeholder-shown:scale-100 peer-focus:-translate-y-2 peer-focus:scale-75 peer-focus:text-text-primary peer-[:not(:placeholder-shown)]:-translate-y-2 peer-[:not(:placeholder-shown)]:scale-75"
                  >
                    {localize('com_ui_prompt_name')}*
                  </label>
                  <div
                    className={cn(
                      'mt-1 w-56 text-sm text-red-500',
                      errors.name ? 'visible h-auto' : 'invisible h-0',
                    )}
                  >
                    {errors.name ? errors.name.message : ' '}
                  </div>
                </div>
              )}
            />
            {!isSmallScreen && (
              <Controller
                name="category"
                control={control}
                rules={{ required: localize('com_ui_prompt_category_required') }}
                render={({ field }) => (
                  <div className="flex flex-col items-end">
                    <CategorySelector value={field.value} onChange={field.onChange} />
                    <div
                      className={cn(
                        'mt-1 text-sm text-red-500',
                        errors.category ? 'visible h-auto' : 'invisible h-0',
                      )}
                    >
                      {errors.category ? errors.category.message : ' '}
                    </div>
                  </div>
                )}
              />
            )}
          </div>
        </div>
        <div className="flex w-full flex-col gap-4 md:mt-[1.075rem]">
          <div className="flex flex-col">
            <header className="flex items-center justify-between rounded-t-xl border border-border-medium bg-transparent p-2">
              <div className="ml-1 flex items-center gap-2">
                <FileText className="size-4 text-text-secondary" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-text-primary">
                  {localize('com_ui_prompt_text')}*
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <VariablesDropdown fieldName="prompt" />
              </div>
            </header>
            <div className="min-h-32 rounded-b-xl border border-t-0 border-border-medium p-3 sm:p-4">
              <Controller
                name="prompt"
                control={control}
                rules={{ required: localize('com_ui_prompt_text_required') }}
                render={({ field }) => (
                  <div>
                    <TextareaAutosize
                      {...field}
                      className="w-full resize-none overflow-y-auto bg-transparent font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary sm:text-base"
                      minRows={4}
                      maxRows={16}
                      tabIndex={0}
                      placeholder={localize('com_ui_prompt_input')}
                      aria-label={localize('com_ui_prompt_input_field')}
                      aria-required="true"
                    />
                    <div
                      className={cn(
                        'mt-1 text-sm text-red-500',
                        errors.prompt ? 'visible h-auto' : 'invisible h-0',
                      )}
                    >
                      {errors.prompt ? errors.prompt.message : ' '}
                    </div>
                  </div>
                )}
              />
            </div>
          </div>
          <PromptVariables promptText={promptText} />
          <Controller
            name="oneliner"
            control={control}
            render={({ field }) => (
              <Description initialValue={field.value} onValueChange={field.onChange} tabIndex={0} />
            )}
          />
          <Controller
            name="command"
            control={control}
            render={({ field }) => (
              <Command initialValue={field.value} onValueChange={field.onChange} tabIndex={0} />
            )}
          />
          <div className="mt-4 flex justify-end">
            <Button
              aria-label={submitLabel}
              className={cn('w-full sm:w-auto', (isSaving || !isValid) && 'opacity-50')}
              tabIndex={0}
              type="submit"
              aria-disabled={isSaving || !isValid || undefined}
              onClick={(e: React.MouseEvent) => {
                if (isSaving) {
                  e.preventDefault();
                }
              }}
            >
              {isSaving ? <Spinner className="size-4" /> : submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
