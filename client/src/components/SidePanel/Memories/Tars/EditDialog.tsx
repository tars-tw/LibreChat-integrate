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
import type { TarsMemoryRow } from './validate';
import {
  withEditedItem,
  categoryLabelKey,
  getTarsMemoryError,
  getTarsMemoryFailureKey,
} from './validate';
import { useGetUserQuery, useUpdateTarsMemoryMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface TarsMemoryEditDialogProps {
  row: TarsMemoryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  triggerRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

export default function TarsMemoryEditDialog({
  row,
  open,
  onOpenChange,
  children,
  triggerRef,
}: TarsMemoryEditDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { mutate: updateMemory, isLoading } = useUpdateTarsMemoryMutation();
  const [text, setText] = useState(row.text);
  const [prevRow, setPrevRow] = useState(row);
  const [prevOpen, setPrevOpen] = useState(open);
  const { data: user } = useGetUserQuery();
  const autoUpdate = user?.personalization?.memoryAutoUpdate !== false;
  const { memory } = row;
  const isProfile = memory.memory_type === 'profile';
  const profileNotice = autoUpdate
    ? 'com_ui_tars_memory_edit_notice_profile'
    : 'com_ui_tars_memory_edit_notice_profile_manual';
  const categoryKey = memory.category ? categoryLabelKey(memory.category) : undefined;

  if (row !== prevRow || open !== prevOpen) {
    setPrevRow(row);
    setPrevOpen(open);
    if (open) {
      setText(row.text);
    }
  }

  const content = isProfile ? withEditedItem(row, text) : text;
  /** The whole profile is checked for its limits, this line for not being emptied. */
  const error =
    getTarsMemoryError(memory.memory_type, text) ?? getTarsMemoryError(memory.memory_type, content);

  const handleSave = () => {
    if (error) {
      return;
    }
    updateMemory(
      { id: memory.id, content },
      {
        onSuccess: () => {
          showToast({ message: localize('com_ui_saved'), status: 'success' });
          onOpenChange(false);
        },
        onError: (failure) => {
          showToast({ message: localize(getTarsMemoryFailureKey(failure)), status: 'error' });
        },
      },
    );
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      {children}
      <OGDialogTemplate
        title={localize('com_ui_edit_memory')}
        showCloseButton={false}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-4">
            <Alert variant="neutral" icon={false} role="note">
              {localize(isProfile ? profileNotice : 'com_ui_tars_memory_edit_notice_semantic')}
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="tars-memory-content" className="text-sm font-medium">
                {localize('com_ui_tars_memory_content')}
              </Label>
              <Textarea
                variant="transparent"
                id="tars-memory-content"
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="max-h-[45vh] min-h-[11.25rem] w-full resize-y"
                rows={8}
                aria-invalid={error != null}
                aria-describedby="tars-memory-content-message"
              />
              <FieldMessage
                id="tars-memory-content-message"
                message={error ? localize(error.key, error.values) : null}
                hint={
                  isProfile
                    ? localize('com_ui_tars_memory_hint_profile', {
                        items: TARS_MEMORY_LIMITS.profileMaxItems,
                        chars: TARS_MEMORY_LIMITS.profileMaxItemChars,
                      })
                    : localize('com_ui_tars_memory_hint_semantic', {
                        chars: TARS_MEMORY_LIMITS.semanticMaxChars,
                      })
                }
              />
            </div>
            {(memory.category || memory.reason) && (
              <dl className="text-text-secondary space-y-1 text-xs">
                {memory.category && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium">
                      {localize('com_ui_tars_memory_category')}
                    </dt>
                    <dd>{categoryKey ? localize(categoryKey) : memory.category}</dd>
                  </div>
                )}
                {memory.reason && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium">
                      {localize('com_ui_tars_memory_reason')}
                    </dt>
                    <dd>{memory.reason}</dd>
                  </div>
                )}
              </dl>
            )}
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
