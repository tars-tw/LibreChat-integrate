import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Pencil } from 'lucide-react';
import { dataService } from 'librechat-data-provider';
import {
  Button,
  Label,
  OGDialog,
  OGDialogTemplate,
  OGDialogTrigger,
  Spinner,
  TooltipAnchor,
  TrashIcon,
  useToastContext,
} from '@librechat/client';
import type { TarsMemoryRow } from './validate';
import { useDeleteTarsMemoryMutation, useUpdateTarsMemoryMutation } from '~/data-provider';
import { categoryLabelKey, getTarsMemoryFailureKey } from './validate';
import TarsMemoryEditDialog from './EditDialog';
import { rowActionSlotClasses } from '~/utils';
import { useLocalize } from '~/hooks';

const formatDate = (dateString: string | null): string | null => {
  if (!dateString) {
    return null;
  }
  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function CardActions({ row, trackDialog }: { row: TarsMemoryRow; trackDialog: () => () => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogOpen = editOpen || deleteOpen;
  const { mutate: deleteMemory, isLoading: isDeleting } = useDeleteTarsMemoryMutation();
  const { mutate: updateMemory, isLoading: isRewriting } = useUpdateTarsMemoryMutation();
  const { memory, itemIndex } = row;
  const navigate = useNavigate();
  const sourceConversationId = itemIndex == null ? memory.conversation_id : null;

  useEffect(() => (dialogOpen ? trackDialog() : undefined), [dialogOpen, trackDialog]);

  /** Checked first: a memory can come from pwc_tars's own chat, which has no conversation here. */
  const openSource = async () => {
    if (!sourceConversationId) {
      return;
    }
    try {
      await dataService.getConversationById(sourceConversationId);
      navigate(`/c/${encodeURIComponent(sourceConversationId)}`);
    } catch {
      showToast({ message: localize('com_ui_tars_memory_source_missing'), status: 'warning' });
    }
  };

  const confirmDelete = () => {
    const callbacks = {
      onSuccess: () => {
        showToast({ message: localize('com_ui_deleted'), status: 'success' });
        setDeleteOpen(false);
      },
      onError: (failure: unknown) => {
        showToast({ message: localize(getTarsMemoryFailureKey(failure)), status: 'error' });
      },
    };
    /** A preference is one line of the profile record; only the last line takes the record along. */
    const remaining = (memory.items ?? []).filter((_item, index) => index !== itemIndex);
    if (itemIndex != null && remaining.length > 0) {
      updateMemory({ id: memory.id, content: remaining.join('\n') }, callbacks);
      return;
    }
    deleteMemory(memory.id, callbacks);
  };

  return (
    <div className={rowActionSlotClasses({ open: dialogOpen })}>
      {sourceConversationId && (
        <TooltipAnchor
          description={localize('com_ui_tars_memory_source')}
          side="top"
          render={
            <Button
              type="button"
              variant="row-action-reveal"
              size="icon-xs"
              aria-label={localize('com_ui_tars_memory_source')}
              onClick={openSource}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
            </Button>
          }
        />
      )}
      <TarsMemoryEditDialog
        row={row}
        open={editOpen}
        onOpenChange={setEditOpen}
        triggerRef={triggerRef as React.MutableRefObject<HTMLButtonElement | null>}
      >
        <OGDialogTrigger asChild>
          <TooltipAnchor
            description={localize('com_ui_edit_memory')}
            side="top"
            render={
              <Button
                ref={triggerRef}
                type="button"
                variant="row-action-reveal"
                size="icon-xs"
                data-open={editOpen || undefined}
                aria-label={localize('com_ui_edit_memory')}
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </OGDialogTrigger>
      </TarsMemoryEditDialog>

      <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <OGDialogTrigger asChild>
          <TooltipAnchor
            description={localize('com_ui_delete_memory')}
            side="top"
            render={
              <Button
                type="button"
                variant="row-action-reveal"
                size="icon-xs"
                data-open={deleteOpen || undefined}
                aria-label={localize('com_ui_delete_memory')}
                onClick={() => setDeleteOpen(true)}
              >
                {isDeleting || isRewriting ? (
                  <Spinner className="size-4" />
                ) : (
                  <TrashIcon className="size-4" aria-hidden="true" />
                )}
              </Button>
            }
          />
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_ui_delete_memory')}
          className="w-11/12 max-w-lg"
          main={
            <Label className="block text-start text-sm font-medium">
              {localize('com_ui_tars_memory_delete_confirm')}
            </Label>
          }
          selection={{
            selectHandler: confirmDelete,
            selectClasses:
              'bg-surface-destructive text-text-on-status hover:bg-surface-destructive-hover',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
    </div>
  );
}

/** What kind of memory a row is: its category, or the kind itself where it has none. */
function useRowBadge({ memory, itemIndex }: TarsMemoryRow): string {
  const localize = useLocalize();
  if (itemIndex != null) {
    return localize('com_ui_tars_memory_section_profile');
  }
  const categoryKey = memory.category ? categoryLabelKey(memory.category) : undefined;
  if (categoryKey) {
    return localize(categoryKey);
  }
  return memory.category ?? localize('com_ui_tars_memory_section_semantic');
}

export default function TarsMemoryCard({
  row,
  hasUpdateAccess,
  trackDialog,
}: {
  row: TarsMemoryRow;
  hasUpdateAccess: boolean;
  /** Called when a dialog opens; the function it returns is called when that dialog closes. */
  trackDialog: () => () => void;
}) {
  const badge = useRowBadge(row);
  const date = formatDate(row.memory.updated_at);

  return (
    <div className="group hover:bg-surface-active-alt rounded-lg bg-transparent px-3 py-2.5">
      {/* The memory itself is what a row is for, so it leads and keeps the full width. */}
      <p className="text-text-primary line-clamp-3 text-sm break-words" title={row.text}>
        {row.text}
      </p>

      {/* Kind + Date + Actions: revealing the actions never rewraps the text above. */}
      <div className="mt-1.5 flex min-h-6 items-center gap-2">
        <span className="bg-surface-tertiary text-text-secondary min-w-0 truncate rounded-full px-2 py-0.5 text-xs">
          {badge}
        </span>
        {date != null && (
          <span className="text-text-secondary ms-auto shrink-0 text-xs">{date}</span>
        )}
        {hasUpdateAccess && <CardActions row={row} trackDialog={trackDialog} />}
      </div>
    </div>
  );
}
