import { useCallback } from 'react';
import { useToastContext } from '@librechat/client';
import { Constants } from 'librechat-data-provider';
import { useSelectedTarsDomain } from '~/components/Chat/Menus/Tars/domain';
import { useUploadTarsMemoryMutation } from '~/data-provider/Tars';
import { useChatContext } from '~/Providers';
import useLocalize from '../useLocalize';

export interface TarsMemoryUploadOptions {
  /** VLM toggle for image files; off = text + OCR only (pwc_tars default: on). */
  processImages?: boolean;
  /** Speech-to-text model for audio files. */
  sttModelName?: string;
}

/**
 * The TARS-mode chat upload: sends files into the pwc_tars long-term memory
 * area on behalf of the 記憶資料管理 dialog. On a brand-new chat pwc_tars
 * creates the conversation first; the returned id is stashed on conversation
 * state and adopted server-side by the first send.
 */
export default function useTarsMemoryUpload(onUploaded?: () => void) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation, setConversation } = useChatContext();
  const { selectedId: domainId } = useSelectedTarsDomain();

  const uploadMutation = useUploadTarsMemoryMutation({
    onSuccess: (result) => {
      if (result.tars_conversation_id) {
        setConversation((prev) =>
          prev ? { ...prev, tarsConversationId: result.tars_conversation_id } : prev,
        );
      }
      if (result.rejected_files.length > 0) {
        showToast({
          status: 'warning',
          message: localize('com_ui_tars_memory_rejected', {
            0: result.rejected_files.map((file) => file.filename).join(', '),
          }),
        });
      } else {
        showToast({
          status: 'success',
          message: localize('com_ui_tars_memory_upload_success', {
            0: String(result.processed_files.length),
          }),
        });
      }
      onUploaded?.();
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_ui_tars_memory_upload_error') });
    },
  });

  const { mutate, isLoading } = uploadMutation;

  const uploadFiles = useCallback(
    (files: File[], options?: TarsMemoryUploadOptions) => {
      if (!files.length || isLoading) {
        return;
      }
      const formData = new FormData();
      for (const file of files) {
        /** multer/busboy decodes multipart filenames as latin1, mangling CJK names;
         *  percent-encode here and decode server-side, same as `useFileHandling`. */
        formData.append('files', file, encodeURIComponent(file.name));
      }
      const conversationId = conversation?.conversationId;
      if (conversationId && conversationId !== Constants.NEW_CONVO) {
        formData.append('conversationId', conversationId);
      } else if (conversation?.tarsConversationId) {
        /** A prior upload on this unsent chat already created the pwc_tars conversation. */
        formData.append('tarsConversationId', conversation.tarsConversationId);
      }
      formData.append('domainId', domainId);
      if (conversation?.model) {
        formData.append('modelName', conversation.model);
      }
      formData.append('processImages', String(options?.processImages ?? true));
      if (options?.sttModelName) {
        formData.append('sttModelName', options.sttModelName);
      }
      mutate(formData);
    },
    [conversation, domainId, mutate, isLoading],
  );

  return { uploadFiles, isUploading: isLoading };
}
