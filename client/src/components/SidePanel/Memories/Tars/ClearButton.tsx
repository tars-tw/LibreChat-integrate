import { useState } from 'react';
import {
  Button,
  Label,
  OGDialog,
  OGDialogTemplate,
  OGDialogTrigger,
  useToastContext,
} from '@librechat/client';
import { useClearTarsMemoriesMutation } from '~/data-provider';
import { getTarsMemoryFailureKey } from './validate';
import { useLocalize } from '~/hooks';

/** At the end of the list, out of the way: it is rarely needed and cannot be undone. */
export default function TarsMemoryClearButton() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const { mutate: clearMemories } = useClearTarsMemoriesMutation();

  const confirmClear = () => {
    clearMemories(undefined, {
      onSuccess: () => {
        showToast({ message: localize('com_ui_deleted'), status: 'success' });
        setOpen(false);
      },
      onError: (failure) => {
        showToast({ message: localize(getTarsMemoryFailureKey(failure)), status: 'error' });
      },
    });
  };

  return (
    <div className="flex justify-center pt-2">
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {localize('com_ui_tars_memory_clear')}
          </Button>
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_ui_tars_memory_clear')}
          className="w-11/12 max-w-lg"
          main={
            <Label className="block text-start text-sm font-medium">
              {localize('com_ui_tars_memory_clear_confirm')}
            </Label>
          }
          selection={{
            selectHandler: confirmClear,
            selectClasses:
              'bg-surface-destructive text-text-on-status hover:bg-surface-destructive-hover',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </div>
  );
}
