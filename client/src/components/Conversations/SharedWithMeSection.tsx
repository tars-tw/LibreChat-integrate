import { memo, useCallback, useState } from 'react';
import { Button, buttonVariants } from '@librechat/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, MessageSquareShare } from 'lucide-react';
import type { SharedWithMeLink } from 'librechat-data-provider';
import { useLocalize, useLocalStorage } from '~/hooks';
import { useSharedWithMeQuery } from '~/data-provider';
import { Collapse } from '~/components/ui';
import { cn } from '~/utils';

/** Rows shown before "show all", so a long list does not push the chats out of view. */
const INLINE_LIMIT = 10;

const SharedConversationRow = memo(function SharedConversationRow({
  link,
  isActive,
  onOpen,
}: {
  link: SharedWithMeLink;
  isActive: boolean;
  onOpen: (shareId: string) => void;
}) {
  const localize = useLocalize();
  const label = link.sharedBy
    ? localize('com_ui_shared_with_me_item', { 0: link.title, 1: link.sharedBy })
    : link.title;

  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onOpen(link.shareId)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={label}
        title={label}
        data-testid="shared-with-me-item"
        className={cn(
          'focus-visible:ring-text-primary relative flex h-12 w-full items-center gap-2 rounded-lg px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset md:h-9',
          isActive
            ? 'bg-surface-active-alt before:bg-text-primary before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full'
            : 'hover:bg-surface-active-alt',
        )}
      >
        <MessageSquareShare className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
        <span className="text-text-primary min-w-0 flex-1 truncate">{link.title}</span>
        {link.sharedBy && (
          <span className="text-text-secondary max-w-[40%] shrink-0 truncate text-xs">
            {link.sharedBy}
          </span>
        )}
      </button>
    </li>
  );
});

interface SharedWithMeSectionProps {
  toggleNav: () => void;
  isAuthenticated: boolean;
}

/**
 * Conversations other people shared with the user by name or through one of their
 * groups. Opens each one read-only inside the app; hidden while there are none.
 */
const SharedWithMeSection = ({ toggleNav, isAuthenticated }: SharedWithMeSectionProps) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useLocalStorage('sharedWithMeSectionExpanded', true);
  const [showAll, setShowAll] = useState(false);
  const { data } = useSharedWithMeQuery({ enabled: isAuthenticated });

  const activeShareId = /^\/shared\/([^/]+)$/.exec(location.pathname)?.[1] ?? null;
  const openShare = useCallback(
    (shareId: string) => {
      navigate(`/shared/${encodeURIComponent(shareId)}`);
      toggleNav();
    },
    [navigate, toggleNav],
  );

  const links = data?.links ?? [];
  if (!isAuthenticated || links.length === 0) {
    return null;
  }

  const visible = showAll ? links : links.slice(0, INLINE_LIMIT);

  return (
    <div className="flex flex-col px-3 text-sm" data-testid="shared-with-me-section">
      <div className="flex h-8 w-full items-center pr-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(buttonVariants({ variant: 'section-header' }), 'group min-w-0 flex-1')}
          aria-expanded={isExpanded}
        >
          <span className="truncate select-none">{localize('com_ui_shared_with_me')}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-200',
              isExpanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      <Collapse open={isExpanded}>
        <ul className="m-0 list-none p-0 pt-0.5">
          {visible.map((link) => (
            <SharedConversationRow
              key={link.shareId}
              link={link}
              isActive={link.shareId === activeShareId}
              onOpen={openShare}
            />
          ))}
          {links.length > INLINE_LIMIT && (
            <li className="list-none">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAll(!showAll)}
                className="text-text-secondary hover:bg-surface-hover hover:text-text-primary flex h-8 w-full justify-start rounded-lg px-2 text-xs font-medium transition-colors"
              >
                {showAll
                  ? localize('com_ui_show_less')
                  : localize('com_ui_show_all_count', { 0: links.length })}
              </Button>
            </li>
          )}
        </ul>
      </Collapse>
    </div>
  );
};

SharedWithMeSection.displayName = 'SharedWithMeSection';

export default memo(SharedWithMeSection);
