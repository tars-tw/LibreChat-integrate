import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NotebookPen } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useIsTarsLinkedUser } from '~/hooks/Tars/useTarsChatPrompts';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Panel from './Panel';

const GAP = 8;
const MAX_PANEL_WIDTH = 384;

/**
 * "我的提示" entry point in the chat composer. Opens a panel listing the
 * pwc_tars prompts for the chat (personal, plus those of the knowledge bases the
 * selected agent's 知識庫檢索 picked) and lets the user insert or quickly create
 * one. Renders nothing for accounts not linked to pwc_tars. The panel is portaled
 * to `document.body` so the composer's `overflow-hidden` doesn't clip it.
 */
function PromptsButton({
  insertPrompt,
  disabled,
}: {
  insertPrompt: (text: string) => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isTarsUser = useIsTarsLinkedUser();

  const reposition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - MAX_PANEL_WIDTH - GAP));
      setCoords({ left, bottom: window.innerHeight - rect.top + GAP });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    reposition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  const handleInsert = useCallback(
    (text: string) => {
      insertPrompt(text);
      setOpen(false);
    },
    [insertPrompt],
  );

  if (!isTarsUser) {
    return null;
  }

  return (
    <div ref={anchorRef} className="flex items-center">
      <TooltipAnchor
        id="tars-prompts-button"
        aria-label={localize('com_ui_tars_prompts')}
        description={localize('com_ui_tars_prompts')}
        disabled={disabled}
        tabIndex={0}
        role="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex size-9 items-center justify-center rounded-full p-1 transition-colors',
          'text-text-primary hover:bg-surface-hover',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <NotebookPen size={18} aria-hidden={true} />
      </TooltipAnchor>
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-50"
            style={{ left: coords.left, bottom: coords.bottom }}
            onClick={(e) => e.stopPropagation()}
          >
            <Panel onInsert={handleInsert} />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default memo(PromptsButton);
