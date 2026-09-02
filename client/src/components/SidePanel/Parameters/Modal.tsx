import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@librechat/client';
import { useLocalize } from '~/hooks';

/**
 * Shell shared by every 模型參數 dialog — the agent builder's model picker and the
 * chat header's per-conversation parameters. Keeping one shell means the two stay
 * visually identical without either owning the other's state.
 */
export default function ParametersModal({
  open,
  title,
  titleId,
  onClose,
  onConfirm,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children: React.ReactNode;
}) {
  const localize = useLocalize();

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-primary shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border-light px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-text-primary">
            {title}
          </h2>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label={localize('com_ui_close')}
            className="h-9 w-9 rounded-xl text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          <div className="flex w-full flex-col gap-3 text-sm">{children}</div>
        </div>

        <footer className="flex flex-shrink-0 justify-end gap-2 border-t border-border-light px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} className="h-9 rounded-xl px-5">
            {localize('com_ui_close')}
          </Button>

          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="h-9 rounded-xl px-5"
          >
            {localize('com_ui_confirm')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
