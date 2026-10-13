import { useCallback, useEffect, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import type { Workspace } from './WorkspaceSwitcher';
import type { TranslationKeys } from '~/hooks';
import WorkspaceSwitcher, { OWN_WORKSPACE, actAsOf } from './WorkspaceSwitcher';
import { useTarsWorkflowTicketMutation } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { langflowSignInUrl } from '~/utils/langflow';

const statusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } })?.response?.status;

/** What to tell the user when no ticket could be had; only a transient failure offers a retry. */
const failureOf = (error: unknown): { message: TranslationKeys; canRetry: boolean } => {
  const status = statusOf(error);
  if (status === 403) {
    return { message: 'com_ui_langflow_no_access', canRetry: false };
  }
  if (status === 404) {
    return { message: 'com_ui_langflow_no_workspace', canRetry: false };
  }
  if (status === 503) {
    return { message: 'com_ui_langflow_not_configured', canRetry: false };
  }
  return { message: 'com_ui_langflow_signin_failed', canRetry: true };
};

/**
 * Embeds Langflow signed in as the current user's own account. Every visit asks LibreChat for
 * a fresh one-time ticket and loads Langflow through its sign-in address, which trades the
 * ticket for a Langflow session and continues into the app — no second login. An admin can
 * switch the iframe into the system account or another user's workspace.
 */
export default function LangflowView() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const [workspace, setWorkspace] = useState<Workspace>(OWN_WORKSPACE);
  const [src, setSrc] = useState<string | null>(null);
  const { mutate, isError, error } = useTarsWorkflowTicketMutation({
    onSuccess: ({ ticket }) => setSrc(langflowSignInUrl(ticket)),
  });

  const signIn = useCallback(
    (target: Workspace) => {
      setSrc(null);
      mutate(actAsOf(target));
    },
    [mutate],
  );

  useEffect(() => {
    signIn(OWN_WORKSPACE);
  }, [signIn]);

  const switchWorkspace = (target: Workspace) => {
    setWorkspace(target);
    signIn(target);
  };

  const renderContent = () => {
    if (isError) {
      const { message, canRetry } = failureOf(error);
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p role="alert" className="text-sm text-text-secondary">
            {localize(message)}
          </p>
          {canRetry && (
            <Button variant="outline" onClick={() => signIn(workspace)}>
              {localize('com_ui_retry')}
            </Button>
          )}
        </div>
      );
    }
    if (!src) {
      return (
        <div
          className="flex h-full w-full items-center justify-center"
          aria-busy="true"
          aria-label={localize('com_ui_loading')}
        >
          <Spinner className="text-text-secondary" />
        </div>
      );
    }
    return (
      <iframe
        src={src}
        title={localize('com_ui_langflow')}
        className="h-full w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    );
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-primary">
      {isAdmin && <WorkspaceSwitcher value={workspace} onChange={switchWorkspace} />}
      <div className="min-h-0 flex-1">{renderContent()}</div>
    </div>
  );
}
