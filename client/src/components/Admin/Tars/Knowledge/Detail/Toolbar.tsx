import { Button, Input, Spinner } from '@librechat/client';
import { Plus, RotateCw, Search, Trash2 } from 'lucide-react';
import { useLocalize } from '~/hooks';

/**
 * The row above every dataset table: filter, refresh, an optional batch-delete
 * button, and the tab's own "add" action.
 */
export default function Toolbar({
  search,
  onSearchChange,
  onRefresh,
  isRefreshing,
  selectedCount,
  onBatchDelete,
  addLabel,
  onAdd,
  addDisabled,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Omit `onBatchDelete` on tabs pwc_tars cannot batch-delete. */
  selectedCount?: number;
  onBatchDelete?: () => void;
  addLabel?: string;
  onAdd?: () => void;
  addDisabled?: boolean;
}) {
  const localize = useLocalize();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={localize('com_ui_tars_kb_ds_search')}
          aria-label={localize('com_ui_tars_kb_ds_search')}
          className="pl-9"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label={localize('com_ui_refresh')}
        title={localize('com_ui_refresh')}
      >
        {isRefreshing ? (
          <Spinner className="size-4" />
        ) : (
          <RotateCw className="size-4" aria-hidden />
        )}
      </Button>

      {onBatchDelete != null && (selectedCount ?? 0) > 0 && (
        <Button variant="destructive" onClick={onBatchDelete} className="gap-1.5">
          <Trash2 className="size-4" aria-hidden />
          {localize('com_ui_tars_kb_ds_batch_delete')}
          <span className="rounded-full bg-surface-primary/20 px-1.5 text-xs tabular-nums">
            {selectedCount}
          </span>
        </Button>
      )}

      {onAdd != null && addLabel != null && (
        <Button variant="submit" onClick={onAdd} disabled={addDisabled} className="ml-auto gap-1.5">
          <Plus className="size-4" aria-hidden />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
