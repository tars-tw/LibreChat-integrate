import { memo, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import type { TTarsDomain } from 'librechat-data-provider';
import { useTarsDomainsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Panel from './Panel';

const DEFAULT_DOMAIN_NAME = 'general';
const GAP = 8;
const MAX_PANEL_WIDTH = 384;

const resolveDefaultDomain = (domains: TTarsDomain[]): TTarsDomain | undefined =>
  domains.find((domain) => domain.name.trim().toLowerCase() === DEFAULT_DOMAIN_NAME) ?? domains[0];

/**
 * "我的提示" entry point in the chat composer. Opens a panel listing the
 * three-tier pwc_tars prompts for the conversation's current specialized brain
 * and lets the user insert or quickly create one. Renders nothing for non-tars
 * users (no accessible brains). The panel is portaled to `document.body` so the
 * composer's `overflow-hidden` doesn't clip it.
 */
function PromptsButton({
  domainId,
  insertPrompt,
  disabled,
}: {
  domainId?: string | null;
  insertPrompt: (text: string) => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: domains = [] } = useTarsDomainsQuery();

  const effectiveDomain = useMemo(() => {
    const target = domainId ? String(domainId) : null;
    return (
      (target && domains.find((domain) => String(domain.id) === target)) ||
      resolveDefaultDomain(domains)
    );
  }, [domains, domainId]);

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

  if (!domains.length || !effectiveDomain) {
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
        <Lightbulb size={18} aria-hidden={true} />
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
            <Panel domain={effectiveDomain} onInsert={handleInsert} />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default memo(PromptsButton);
