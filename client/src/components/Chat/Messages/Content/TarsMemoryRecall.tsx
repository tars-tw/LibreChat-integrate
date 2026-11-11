import { useId, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Brain, ChevronDown } from 'lucide-react';
import { ROW_GLYPH_SLOT } from '@librechat/chat/components';
import { Button, disclosureChevronVariants } from '@librechat/client';
import { Permissions, PermissionTypes, Tools } from 'librechat-data-provider';
import type { TAttachment, TTarsMemory, TTarsMemoryRecall } from 'librechat-data-provider';
import { showTarsMemoryRecallAtom } from '~/components/SidePanel/Memories/Tars/store';
import { toTarsMemoryRows } from '~/components/SidePanel/Memories/Tars/validate';
import { useTarsMemoriesQuery } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Holds the query, so a message with nothing recalled does not observe the memory list. */
function RecallDisclosure({ recall }: { recall: TTarsMemoryRecall }) {
  const contentId = useId();
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const { data, isError } = useTarsMemoriesQuery({ enabled: open });

  const { rows, missing } = useMemo(() => {
    const ids = new Set(recall.ids);
    const found: TTarsMemory[] = (data?.memories ?? []).filter((memory) => ids.has(memory.id));
    return { rows: toTarsMemoryRows(found), missing: ids.size - found.length };
  }, [data, recall]);

  return (
    <div className="mt-1 mb-1">
      <div className="relative flex h-5 shrink-0 items-center gap-1.5">
        <Button
          variant="disclosure"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-controls={contentId}
          className="group/disclosure min-w-0 flex-1"
        >
          <span className={ROW_GLYPH_SLOT} aria-hidden="true">
            <Brain className="text-text-secondary size-4 shrink-0" />
          </span>
          <span className="tool-status-text text-text-secondary font-medium">
            {localize('com_ui_tars_memory_recall', { count: recall.count })}
          </span>
          <ChevronDown
            className={cn(
              disclosureChevronVariants({ expanded: open }),
              'size-4 translate-y-[1px]',
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      {open && (
        <div id={contentId} className="text-text-secondary mt-1 space-y-1 ps-6 text-sm">
          {isError && <p>{localize('com_ui_tars_memory_error_load')}</p>}
          {rows.length > 0 && (
            <ul className="list-disc space-y-1 ps-4">
              {rows.map((row) => (
                <li key={row.key} className="break-words">
                  {row.text}
                </li>
              ))}
            </ul>
          )}
          {data != null && missing > 0 && (
            <p className="text-xs">{localize('com_ui_tars_memory_recall_missing')}</p>
          )}
          <p className="text-xs">{localize('com_ui_tars_memory_recall_hint')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Says what a reply could refer to. The message holds only ids, so the text comes from the
 * user's current memory when opened: an edited or deleted memory shows as gone, not as it was.
 * A role without `MEMORIES.READ` cannot read that memory, so it sees no line to open.
 */
export default function TarsMemoryRecall({ attachments }: { attachments?: TAttachment[] }) {
  const showSetting = useAtomValue(showTarsMemoryRecallAtom);
  const canRead = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });
  const show = showSetting && canRead;
  const recall = useMemo(
    () => attachments?.find((attachment) => attachment?.[Tools.tars_memory])?.[Tools.tars_memory],
    [attachments],
  );
  return show && recall ? <RecallDisclosure recall={recall} /> : null;
}
