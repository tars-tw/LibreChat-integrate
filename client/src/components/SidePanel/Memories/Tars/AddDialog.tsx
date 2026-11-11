import React, { useState } from 'react';
import { TARS_MEMORY_LIMITS } from 'librechat-data-provider';
import {
  Alert,
  Button,
  FieldMessage,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import { useCreateTarsMemoryMutation, useGetUserQuery } from '~/data-provider';
import { getTarsMemoryAddError, getTarsMemoryFailureKey } from './validate';
import { useLocalize } from '~/hooks';

interface TarsMemoryAddDialogProps {
  /** What the profile already holds, which counts toward its limit. */
  heldItems: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export default function TarsMemoryAddDialog({
  heldItems,
  open,
  onOpenChange,
  children,
}: TarsMemoryAddDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const autoUpdate = user?.personalization?.memoryAutoUpdate !== false;
  const { mutate: createMemory, isLoading } = useCreateTarsMemoryMutation();
  const [text, setText] = useState('');
  const error = getTarsMemoryAddError(text, heldItems);
  /** A pristine field stays quiet; the disabled button already says it needs content. */
  const showError = text !== '' && error != null;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setText('');
    }
    onOpenChange(next);
  };

  const handleSave = () => {
    if (error) {
      return;
    }
    createMemory(text, {
      onSuccess: () => {
        showToast({ message: localize('com_ui_saved'), status: 'success' });
        handleOpenChange(false);
      },
      onError: (failure) => {
        showToast({ message: localize(getTarsMemoryFailureKey(failure)), status: 'error' });
      },
    });
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      {children}
      <OGDialogTemplate
        title={localize('com_ui_tars_memory_add')}
        showCloseButton={false}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-4">
            <Alert variant="neutral" icon={false} role="note">
              {localize(
                autoUpdate
                  ? 'com_ui_tars_memory_add_notice'
                  : 'com_ui_tars_memory_add_notice_manual',
              )}
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="tars-memory-new" className="text-sm font-medium">
                {localize('com_ui_tars_memory_content')}
              </Label>
              <Textarea
                variant="transparent"
                id="tars-memory-new"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={localize('com_ui_tars_memory_add_placeholder')}
                className="max-h-[45vh] min-h-[11.25rem] w-full resize-y"
                rows={8}
                aria-invalid={showError}
                aria-describedby="tars-memory-new-message"
              />
              <FieldMessage
                id="tars-memory-new-message"
                message={showError ? localize(error.key, error.values) : null}
                hint={localize('com_ui_tars_memory_hint_add', {
                  count: heldItems.length,
                  items: TARS_MEMORY_LIMITS.profileMaxItems,
                  chars: TARS_MEMORY_LIMITS.profileMaxItemChars,
                })}
              />
            </div>
          </div>
        }
        buttons={
          <Button
            type="button"
            variant="submit"
            onClick={handleSave}
            aria-label={localize('com_ui_save')}
            disabled={isLoading || error != null}
          >
            {isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
