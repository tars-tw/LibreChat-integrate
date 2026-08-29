import React from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { TooltipAnchor, AttachmentIcon } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import MemoryDialog from '~/components/Tars/MemoryDialog';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

/**
 * The TARS-mode paperclip: it opens the 記憶資料管理 dialog (pwc_tars styling,
 * with the image-recognition and transcription-model upload options) in place
 * of the native upload menu. The dialog is mounted here only — drag-drop and
 * the side-panel button open this same instance through a recoil atom, and all
 * three are hidden in a temporary conversation.
 */
function TarsMemoryAttach({
  disabled,
}: {
  disabled?: boolean;
  conversation: TConversation | null;
}) {
  const localize = useLocalize();
  const setDialogOpen = useSetRecoilState(store.tarsMemoryDialogOpen);
  const isTemporary = useRecoilValue(store.isTemporary);

  /** Memory rows outlive the chat, which contradicts a temporary conversation. */
  if (isTemporary) {
    return null;
  }

  return (
    <>
      <TooltipAnchor
        render={
          <button
            type="button"
            disabled={disabled ?? false}
            id="tars-memory-attach-button"
            aria-label={localize('com_ui_tars_memory_management')}
            className={cn(
              'flex size-theme-control items-center justify-center rounded-theme-control-round p-1 transition-colors duration-theme-fast hover:bg-surface-composer-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-opacity-50',
            )}
            onClick={() => setDialogOpen(true)}
          >
            <div className="flex w-full items-center justify-center gap-2">
              <AttachmentIcon />
            </div>
          </button>
        }
        id="tars-memory-attach-button"
        description={localize('com_ui_tars_memory_management')}
        disabled={disabled ?? false}
      />
      <MemoryDialog />
    </>
  );
}

export default React.memo(TarsMemoryAttach);
