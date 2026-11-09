import { useState } from 'react';
import { OGDialogHeader, OGDialogTitle, OGDialogDescription } from '@librechat/client';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { AgentItem } from '../items/types';
import { SECTION_LABEL_KEYS, itemSection } from '../items/sections';
import { getIconForItem } from '../items/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

function HeaderIcon({ item }: { item: AgentItem }) {
  const { Icon, colorClass, iconUrl } = getIconForItem(item);
  const [imgError, setImgError] = useState(false);

  if (iconUrl && !imgError) {
    return (
      <span
        className="bg-surface-fixed flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
        aria-hidden="true"
      >
        <img
          src={iconUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', colorClass)}
      aria-hidden="true"
    >
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}

export default function ItemDialogHeader({ item }: { item: AgentItem }) {
  const localize = useLocalize();
  const displayName = item.kind === 'builtin' ? localize(item.name as TranslationKeys) : item.name;
  const kindLabel = localize(SECTION_LABEL_KEYS[itemSection(item)]);

  return (
    <OGDialogHeader className="flex flex-row items-center gap-3 space-y-0 px-6 pt-5 pb-4 text-start">
      <HeaderIcon item={item} />
      <div className="min-w-0 flex-1">
        <OGDialogTitle className="truncate text-base font-semibold">{displayName}</OGDialogTitle>
        <OGDialogDescription className="text-2xs m-0 tracking-wide uppercase">
          {kindLabel}
        </OGDialogDescription>
      </div>
    </OGDialogHeader>
  );
}
