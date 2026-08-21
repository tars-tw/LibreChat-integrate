import { Button, OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';

/**
 * One confirmation prompt, shared by every destructive dataset action.
 *
 * The dataset tabs have a dozen of these between them; keeping the markup in
 * one place is what stops them drifting apart.
 */
export default function ConfirmDialog({
  title,
  message,
  note,
  confirmLabel,
  destructive,
  isBusy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  /** An extra consequence worth spelling out, shown in a bordered block. */
  note?: string;
  confirmLabel: string;
  destructive?: boolean;
  isBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <OGDialogTemplate
        title={title}
        className="w-11/12 max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-2">
            <p className="break-words text-sm text-text-secondary">{message}</p>
            {note != null && (
              <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                {note}
              </p>
            )}
          </div>
        }
        buttons={
          <Button
            variant={destructive === true ? 'destructive' : 'submit'}
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? <Spinner className="size-4" /> : confirmLabel}
          </Button>
        }
      />
    </OGDialog>
  );
}
