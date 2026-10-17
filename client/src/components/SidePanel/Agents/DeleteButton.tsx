import { memo } from 'react';
import { useSetAtom } from 'jotai';
import { useFormContext } from 'react-hook-form';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { resolveStatefulCodeEnvironment } from 'librechat-data-provider';
import {
  Label,
  Button,
  OGDialog,
  TrashIcon,
  useToastContext,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import type { Agent, AgentCreateParams } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import { useDeleteAgentMutation, useTarsDomainsQuery } from '~/data-provider';
import { useAuthContext, useGetAgentsConfig, useLocalize } from '~/hooks';
import { logger, getDefaultAgentFormValues } from '~/utils';
import { deletedChatAgentIdAtom } from '~/store/agents';
import { isEphemeralAgent } from '~/common';
import store from '~/store';

function DeleteButton({
  agent_id,
  setCurrentAgentId,
  createMutation,
}: {
  agent_id: string;
  setCurrentAgentId: React.Dispatch<React.SetStateAction<string | undefined>>;
  createMutation: UseMutationResult<Agent, Error, AgentCreateParams>;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { agentsConfig } = useGetAgentsConfig();
  const { reset } = useFormContext();
  const { showToast } = useToastContext();
  const setConversation = useSetRecoilState(store.conversationByIndex(0));
  const conversationAgentId = useRecoilValue(store.conversationAgentIdByIndex(0));
  const setDeletedChatAgentId = useSetAtom(deletedChatAgentIdAtom);
  const { data: tarsDomains } = useTarsDomainsQuery();

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: (_, vars, context) => {
      const updatedList = context as Agent[] | undefined;
      if (!updatedList) {
        return;
      }

      showToast({
        message: localize('com_ui_agent_deleted'),
        status: 'success',
      });

      if (createMutation.data?.id ?? '') {
        logger.log('agents', 'resetting createMutation');
        createMutation.reset();
      }

      /** With TARS brains the header picker takes the chat back to the general brain —
       *  the deleted agent may have carried the conversation onto its own brain, where
       *  no picker is offered — instead of switching it onto another agent. */
      const leavesChatAgent =
        vars.agent_id === conversationAgentId && (tarsDomains?.length ?? 0) > 0;
      if (leavesChatAgent) {
        setDeletedChatAgentId(vars.agent_id);
      }

      const firstAgent = updatedList[0] as Agent | undefined;
      if (!firstAgent) {
        setCurrentAgentId(undefined);
        reset(
          getDefaultAgentFormValues(
            resolveStatefulCodeEnvironment(
              user?.personalization?.statefulCodeEnvironment ?? 'user',
              agentsConfig?.statefulCodeSessions?.allowedEnvironments,
            ) ?? 'user',
          ),
        );
        if (!leavesChatAgent) {
          setConversation((prev) => (prev ? { ...prev, agent_id: '' } : prev));
        }
        return;
      }

      if (leavesChatAgent) {
        setCurrentAgentId(firstAgent.id);
        return;
      }

      if (vars.agent_id === conversationAgentId) {
        setConversation((prev) => (prev ? { ...prev, model: '', agent_id: firstAgent.id } : prev));
        return;
      }

      const currentAgent = updatedList.find((agent) => agent.id === conversationAgentId);

      if (currentAgent) {
        setCurrentAgentId(currentAgent.id);
      }

      setCurrentAgentId(firstAgent.id);
    },
    onError: (error) => {
      console.error(error);
      showToast({
        message: localize('com_ui_agent_delete_error'),
        status: 'error',
      });
    },
  });

  if (isEphemeralAgent(agent_id)) {
    return null;
  }

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label={localize('com_ui_delete_agent')}
          title={localize('com_ui_delete_agent')}
          type="button"
        >
          <div className="text-text-destructive flex w-full items-center justify-center gap-2">
            <TrashIcon />
          </div>
        </Button>
      </OGDialogTrigger>
      <OGDialogTemplate
        title={localize('com_ui_delete_agent')}
        className="max-w-[28.125rem]"
        main={
          <>
            <div className="flex w-full flex-col items-center gap-2">
              <div className="grid w-full items-center gap-2">
                <Label htmlFor="delete-agent" className="text-start text-sm font-medium">
                  {localize('com_ui_delete_agent_confirm')}
                </Label>
              </div>
            </div>
          </>
        }
        selection={{
          selectHandler: () => deleteAgent.mutate({ agent_id }),
          selectClasses:
            'bg-surface-destructive hover:bg-surface-destructive-hover text-text-on-status',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
  );
}

const MemoizedDeleteButton = memo(
  DeleteButton,
  (prevProps, nextProps) =>
    prevProps.agent_id === nextProps.agent_id &&
    prevProps.setCurrentAgentId === nextProps.setCurrentAgentId &&
    prevProps.createMutation.data?.id === nextProps.createMutation.data?.id &&
    prevProps.createMutation.isLoading === nextProps.createMutation.isLoading,
);
MemoizedDeleteButton.displayName = 'DeleteButton';

export default MemoizedDeleteButton;
