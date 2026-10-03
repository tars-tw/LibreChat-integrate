import { useCallback } from 'react';
import { useToastContext } from '@librechat/client';
import type { TTarsModelProfileSync } from 'librechat-data-provider';
import { errorMessage, errorStatus, summarizeSync } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Toasts for model profile writes. A disable, delete or rename can move other
 * settings onto another model, which the success toast spells out; a 409 means
 * no system default model could take those settings over.
 */
export default function useFeedback() {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const notifySuccess = useCallback(
    (message: string, sync?: TTarsModelProfileSync | null) => {
      const moved = summarizeSync(sync);
      showToast({
        message: moved
          ? `${message} ${localize('com_ui_tars_models_sync_moved', {
              count: moved.count,
              name: moved.name,
            })}`
          : message,
        status: 'success',
      });
    },
    [localize, showToast],
  );

  const notifyError = useCallback(
    (error: unknown) =>
      showToast({
        message:
          errorStatus(error) === 409
            ? localize('com_ui_tars_models_no_fallback')
            : (errorMessage(error) ?? localize('com_ui_tars_admin_error')),
        status: 'error',
      }),
    [localize, showToast],
  );

  return { notifySuccess, notifyError };
}
