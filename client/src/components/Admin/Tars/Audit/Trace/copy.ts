import { useCallback, useEffect, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';
import { useToastContext } from '@librechat/client';
import { useLocalize } from '~/hooks';

const COPIED_MS = 2000;

/**
 * The feedback every copy in the trace gives: `isCopied` drives the native
 * `CopyButton`'s check mark, and a failed copy is announced, since a failure
 * the button does not show looks like a dead button.
 */
export function useCopyFeedback(): {
  isCopied: boolean;
  copyText: (text: string | null | undefined) => void;
} {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isCopied, setIsCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copyText = useCallback(
    (text: string | null | undefined) => {
      if (!text) {
        return;
      }
      if (!copy(text)) {
        showToast({ message: localize('com_ui_tars_audit_trace_copy_failed'), status: 'error' });
        return;
      }
      setIsCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setIsCopied(false), COPIED_MS);
    },
    [localize, showToast],
  );

  return { isCopied, copyText };
}
