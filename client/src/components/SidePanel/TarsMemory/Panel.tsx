import { Upload } from 'lucide-react';
import { Button } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import TarsMemoryList from './List';
import store from '~/store';

/**
 * Side-panel long-term memory (長期記憶) manager, which replaces the native
 * attach-files panel in TARS mode: it lists the current conversation's memory
 * documents, and defers every upload to the 記憶資料管理 dialog so the parse
 * options (image recognition, transcription model) are chosen in one place.
 */
export default function TarsMemoryPanel() {
  const localize = useLocalize();
  const setDialogOpen = useSetRecoilState(store.tarsMemoryDialogOpen);
  const isTemporary = useRecoilValue(store.isTemporary);

  /** Memory rows outlive the chat, so the dialog this button opens is not
   *  mounted in a temporary conversation. */
  if (isTemporary) {
    return (
      <div className="h-auto w-full px-3 pb-3 pt-2">
        <p className="px-1 text-sm text-text-secondary">
          {localize('com_ui_tars_memory_temporary_unavailable')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-auto w-full space-y-3 px-3 pb-3 pt-2">
      <Button variant="outline" className="w-full gap-2" onClick={() => setDialogOpen(true)}>
        <Upload className="icon-sm" aria-hidden="true" />
        {localize('com_ui_tars_memory_upload')}
      </Button>
      <TarsMemoryList />
    </div>
  );
}
