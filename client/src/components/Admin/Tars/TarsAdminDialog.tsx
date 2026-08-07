import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { RefObject } from 'react';
import DomainManager from './DomainManager';
import { useLocalize } from '~/hooks';

export default function TarsAdminDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement>;
}) {
  const localize = useLocalize();

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogTemplate
        title={localize('com_ui_tars_domains')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={<DomainManager />}
      />
    </OGDialog>
  );
}
