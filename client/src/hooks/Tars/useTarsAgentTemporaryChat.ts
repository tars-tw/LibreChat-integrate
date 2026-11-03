import { useEffect } from 'react';
import { useTarsAgentSelected } from '~/components/Chat/Menus/Tars/domain';
import useTemporaryChat from '~/hooks/Conversations/useTemporaryChat';
import { useChatSettings } from '~/Providers/ChatSettingsContext';

/**
 * TARS offers temporary chat on the general brain only. With a saved agent picked from
 * My Agents the toggle steps aside, and a mode carried over from the general brain (or the
 * user's 預設使用臨時對話) is switched off before the first message sends. An
 * administrator-enforced retention mode still wins. Returns whether the toggle is hidden.
 */
export default function useTarsAgentTemporaryChat(): boolean {
  const isTarsAgent = useTarsAgentSelected();
  const { setIsTemporary } = useChatSettings();
  const { show, isTemporary, isEnforced } = useTemporaryChat();
  const isHidden = isTarsAgent && !isEnforced;

  useEffect(() => {
    if (isHidden && show && isTemporary) {
      setIsTemporary(false);
    }
  }, [isHidden, show, isTemporary, setIsTemporary]);

  return isHidden;
}
