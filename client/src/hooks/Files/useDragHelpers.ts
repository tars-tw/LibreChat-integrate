import { useRef, useMemo, useCallback } from 'react';
import { useDrop } from 'react-dnd';
import { useToastContext } from '@librechat/client';
import { NativeTypes } from 'react-dnd-html5-backend';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { isAssistantsEndpoint } from 'librechat-data-provider';
import type { DropTargetMonitor } from 'react-dnd';
import { useChatContext } from '~/Providers/ChatContext';
import useFileUploadRouter from './useFileUploadRouter';
import { useGetStartupConfig } from '~/data-provider';
import { useUploadModalContext } from '~/Providers';
import useUploadOptions from './useUploadOptions';
import useLocalize from '../useLocalize';
import store from '~/store';

export default function useDragHelpers() {
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const { conversation } = useChatContext();

  const isAssistants = useMemo(
    () => isAssistantsEndpoint(conversation?.endpoint),
    [conversation?.endpoint],
  );

  const { getOptions, isConfigResolved, isUnifiedMode, uploadsDisabled } = useUploadOptions();
  const routeFiles = useFileUploadRouter();
  const { openModal } = useUploadModalContext();
  const { data: startupConfig } = useGetStartupConfig();
  const setTarsMemoryDialogOpen = useSetRecoilState(store.tarsMemoryDialogOpen);
  const setTarsMemoryStagedFiles = useSetRecoilState(store.tarsMemoryStagedFiles);
  const isTemporary = useRecoilValue(store.isTemporary);
  const tarsMemoryEnabled = startupConfig?.tarsMemoryEnabled === true;

  /** Use refs to avoid re-creating the drop handler */
  const conversationRef = useRef(conversation);
  const getOptionsRef = useRef(getOptions);
  const isConfigResolvedRef = useRef(isConfigResolved);
  const isUnifiedModeRef = useRef(isUnifiedMode);
  const uploadsDisabledRef = useRef(uploadsDisabled);
  const routeFilesRef = useRef(routeFiles);
  const openModalRef = useRef(openModal);
  const isAssistantsRef = useRef(isAssistants);
  const stageTarsMemoryFiles = (files: File[]) => {
    /** Memory rows outlive the chat, so the dialog is not mounted in a temporary
     *  one; staging into it there would swallow the drop silently. */
    if (isTemporary) {
      showToast({
        status: 'warning',
        message: localize('com_ui_tars_memory_temporary_unavailable'),
      });
      return;
    }
    setTarsMemoryStagedFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name} ${file.size}`));
      return [...prev, ...files.filter((file) => !seen.has(`${file.name} ${file.size}`))];
    });
    setTarsMemoryDialogOpen(true);
  };
  const tarsMemoryRef = useRef({ enabled: tarsMemoryEnabled, stage: stageTarsMemoryFiles });

  conversationRef.current = conversation;
  getOptionsRef.current = getOptions;
  isConfigResolvedRef.current = isConfigResolved;
  isUnifiedModeRef.current = isUnifiedMode;
  uploadsDisabledRef.current = uploadsDisabled;
  routeFilesRef.current = routeFiles;
  openModalRef.current = openModal;
  isAssistantsRef.current = isAssistants;
  tarsMemoryRef.current = { enabled: tarsMemoryEnabled, stage: stageTarsMemoryFiles };

  const handleDrop = useCallback(
    (item: { files: File[] }) => {
      /** TARS mode: a drop is staged into the memory dialog instead of uploading
       *  straight away, so the user can confirm the parse options first. */
      if (tarsMemoryRef.current.enabled) {
        tarsMemoryRef.current.stage(item.files);
        return;
      }
      /* Both answers come from the hook the attach menu and the paste path already use.
       * Resolving the endpoint config here as well missed an agent's provider entry, so a
       * named custom provider's rules applied to one flow and not the others. */
      if (uploadsDisabledRef.current) {
        showToast({ message: localize('com_ui_attach_error_disabled'), status: 'error' });
        return;
      }
      /* Neither answer is safe before the config lands: offering the chooser sends an
       * explicit destination on a unified deployment, and skipping it sends none on a
       * legacy one, which the server refuses. Say so instead of guessing. */
      if (!isConfigResolvedRef.current) {
        showToast({ message: localize('com_ui_attach_error_pending'), status: 'warning' });
        return;
      }

      /** Assistants do not use the upload-option flow */
      if (isAssistantsRef.current) {
        routeFilesRef.current(item.files);
        return;
      }

      /* Unified mode decides the destination from the file itself, so a drop must not
       * present the chooser the attach button no longer shows. Offering it here would let
       * the same file be delivered differently depending on how it was added. */
      if (isUnifiedModeRef.current) {
        routeFilesRef.current(item.files);
        return;
      }

      const options = getOptionsRef.current(item.files);
      if (options.length === 0) {
        showToast({ message: localize('com_error_files_unsupported'), status: 'error' });
        return;
      }
      if (options.length === 1) {
        routeFilesRef.current(item.files, options[0]);
        return;
      }
      openModalRef.current(item.files);
    },
    [showToast, localize],
  );

  const [{ canDrop, isOver }, drop] = useDrop(
    () => ({
      accept: [NativeTypes.FILE],
      drop: handleDrop,
      canDrop: () => true,
      collect: (monitor: DropTargetMonitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [handleDrop],
  );

  return { canDrop, isOver, drop };
}
