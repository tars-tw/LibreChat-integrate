import { useRef, useMemo, useCallback } from 'react';
import { useDrop } from 'react-dnd';
import { useToastContext } from '@librechat/client';
import { NativeTypes } from 'react-dnd-html5-backend';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import {
  QueryKeys,
  mergeFileConfig,
  resolveEndpointType,
  isAssistantsEndpoint,
  getEndpointFileConfig,
} from 'librechat-data-provider';
import type { DropTargetMonitor } from 'react-dnd';
import type * as t from 'librechat-data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import useFileUploadRouter from './useFileUploadRouter';
import { useGetStartupConfig } from '~/data-provider';
import { useUploadModalContext } from '~/Providers';
import useUploadOptions from './useUploadOptions';
import useLocalize from '../useLocalize';
import store from '~/store';

export default function useDragHelpers() {
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const { conversation } = useChatContext();

  const isAssistants = useMemo(
    () => isAssistantsEndpoint(conversation?.endpoint),
    [conversation?.endpoint],
  );

  const { getOptions } = useUploadOptions();
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
      /** Early block: leverage endpoint file config to prevent drag/drop on disabled endpoints */
      const currentEndpoint = conversationRef.current?.endpoint ?? 'default';
      const endpointsConfig = queryClient.getQueryData<t.TEndpointsConfig>([QueryKeys.endpoints]);
      const agentId = conversationRef.current?.agent_id;
      const agent = agentId
        ? queryClient.getQueryData<t.Agent>([QueryKeys.agent, agentId])
        : undefined;
      const currentEndpointType = resolveEndpointType(
        endpointsConfig,
        currentEndpoint,
        agent?.provider,
      );
      const cfg = queryClient.getQueryData<t.TFileConfig>([QueryKeys.fileConfig]);
      if (cfg) {
        const endpointCfg = getEndpointFileConfig({
          fileConfig: mergeFileConfig(cfg),
          endpoint: currentEndpoint,
          endpointType: currentEndpointType,
        });
        if (endpointCfg?.disabled === true) {
          showToast({ message: localize('com_ui_attach_error_disabled'), status: 'error' });
          return;
        }
      }

      /** Assistants do not use the upload-option flow */
      if (isAssistantsRef.current) {
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
    [queryClient, showToast, localize],
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
