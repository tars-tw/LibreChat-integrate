import { useCallback, useId, useMemo, useState } from 'react';
import { matchSorter } from 'match-sorter';
import { Brain, Plus, ShieldEllipsis } from 'lucide-react';
import { PermissionTypes, Permissions, SystemRoles } from 'librechat-data-provider';
import {
  Button,
  Dropdown,
  EmptyState,
  FilterInput,
  OGDialogTrigger,
  TooltipAnchor,
} from '@librechat/client';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { TarsMemoryRow } from './validate';
import type { TarsMemoryMode } from './useMode';
import { useGetStartupConfig, useTarsMemoriesQuery } from '~/data-provider';
import { PanelContent, PanelFooter, PanelHeader } from '~/components/ui';
import { useAuthContext, useHasAccess, useLocalize } from '~/hooks';
import MemoryCardSkeleton from '../MemoryCardSkeleton';
import TarsMemoryClearButton from './ClearButton';
import TarsMemoryAddDialog from './AddDialog';
import { toTarsMemoryRows } from './validate';
import AdminSettings from '../AdminSettings';
import TarsMemoryCard from './Card';
import useMode from './useMode';

const EMPTY_KEYS: Record<TarsMemoryMode, TranslationKeys> = {
  auto: 'com_ui_tars_memory_empty',
  manual: 'com_ui_tars_memory_empty_manual',
  off: 'com_ui_tars_memory_empty_off',
};

const INTRO_KEYS: Record<TarsMemoryMode, TranslationKeys> = {
  auto: 'com_ui_tars_memory_intro',
  manual: 'com_ui_tars_memory_intro_manual',
  off: 'com_ui_tars_memory_intro_off',
};

/** Type filter sentinels, the shape of the native panel's partition filter. */
const TYPE_ALL = 'all';
const TYPE_PROFILE = 'profile';
const TYPE_SEMANTIC = 'semantic';

export default function TarsMemoryPanel() {
  const localize = useLocalize();
  const headingId = useId();
  const modeLabelId = useId();
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const { data: startupConfig } = useGetStartupConfig();
  const refreshMs = startupConfig?.tarsMemoryRefreshMs ?? 0;
  /** A refresh can give a row a new id and remount it, which would lose a dialog's edits. */
  const [openDialogs, setOpenDialogs] = useState(0);
  const trackDialog = useCallback(() => {
    setOpenDialogs((count) => count + 1);
    return () => setOpenDialogs((count) => count - 1);
  }, []);
  const {
    data: reply,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useTarsMemoriesQuery({
    refetchOnWindowFocus: openDialogs === 0,
    /** A failing store is not asked again until the user retries; each try logs an error. */
    refetchInterval: (_data, query) =>
      refreshMs > 0 && openDialogs === 0 && query.state.status !== 'error' ? refreshMs : false,
  });
  const data = reply?.memories;
  const disabled = reply?.disabled === true;
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState(TYPE_ALL);
  const [addOpen, setAddOpen] = useState(false);
  const { mode, modeOptions, setMode, isSaving } = useMode();

  const hasUpdateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.UPDATE,
  });
  const hasCreateAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.CREATE,
  });
  const hasOptOutAccess = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.OPT_OUT,
  });

  const rows = useMemo(() => toTarsMemoryRows(data ?? []), [data]);

  /** Only worth offering when both kinds exist; otherwise it would filter nothing. */
  const typeOptions = useMemo(() => {
    const types = new Set(rows.map((row) => row.memory.memory_type));
    if (types.size < 2) {
      return null;
    }
    return [
      { value: TYPE_ALL, label: localize('com_ui_memories_all') },
      { value: TYPE_PROFILE, label: localize('com_ui_tars_memory_section_profile') },
      { value: TYPE_SEMANTIC, label: localize('com_ui_tars_memory_section_semantic') },
    ];
  }, [rows, localize]);

  /** Falls back to "all" once a kind is gone, so the list never gets stuck filtering on it. */
  const activeType = typeOptions ? typeFilter : TYPE_ALL;

  const filteredRows: TarsMemoryRow[] = useMemo(() => {
    const ofType =
      activeType === TYPE_ALL ? rows : rows.filter((row) => row.memory.memory_type === activeType);
    return matchSorter(ofType, searchQuery, {
      keys: ['text', 'memory.category', 'memory.reason'],
      threshold: matchSorter.rankings.CONTAINS,
      /** Ties keep the rows' order, including every row of an empty search. */
      baseSort: (a, b) => a.index - b.index,
    });
  }, [rows, activeType, searchQuery]);

  /** Read off the unfiltered list: a search must not lower the count toward the limit. */
  const heldItems = useMemo(
    () => (data ?? []).find((memory) => memory.memory_type === 'profile')?.items ?? [],
    [data],
  );

  const renderEmptyState = () => {
    if (disabled) {
      return (
        <EmptyState
          icon={Brain}
          title={localize('com_ui_tars_memory_disabled_title')}
          description={localize('com_ui_tars_memory_disabled')}
        />
      );
    }
    if (isError) {
      return (
        <EmptyState
          icon={Brain}
          title={localize('com_ui_tars_memory_error_load_title')}
          description={localize('com_ui_tars_memory_error_load')}
          action={
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              {localize('com_ui_retry')}
            </Button>
          }
        />
      );
    }
    if (searchQuery.length > 0) {
      return <EmptyState icon={Brain} description={localize('com_ui_no_memories_match')} />;
    }
    return (
      <EmptyState
        icon={Brain}
        title={localize('com_ui_tars_memory_empty_title')}
        description={localize(EMPTY_KEYS[mode])}
      />
    );
  };

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="flex h-full w-full flex-col overflow-hidden pt-2"
    >
      <PanelHeader
        title={localize('com_ui_tars_memory_title')}
        titleId={headingId}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {isAdmin && (
              <AdminSettings
                trigger={
                  <TooltipAnchor
                    description={localize('com_ui_admin_settings')}
                    side="bottom"
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={localize('com_ui_admin_settings')}
                      >
                        <ShieldEllipsis className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                }
              />
            )}
            {hasCreateAccess && !disabled && (
              <TarsMemoryAddDialog heldItems={heldItems} open={addOpen} onOpenChange={setAddOpen}>
                <OGDialogTrigger asChild>
                  <TooltipAnchor
                    description={localize('com_ui_tars_memory_add')}
                    side="bottom"
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={localize('com_ui_tars_memory_add')}
                        onClick={() => setAddOpen(true)}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                </OGDialogTrigger>
              </TarsMemoryAddDialog>
            )}
          </div>
        }
        search={
          rows.length > 0 && (
            <FilterInput
              inputId="tars-memory-search"
              label={localize('com_ui_memories_filter')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          )
        }
      >
        {typeOptions && (
          <Dropdown
            value={activeType}
            onChange={setTypeFilter}
            options={typeOptions}
            className="w-full"
            triggerClassName="w-full"
            sameWidth
            ariaLabel={localize('com_ui_tars_memory_type_filter')}
            testId="tars-memory-type-filter"
          />
        )}
      </PanelHeader>

      <PanelContent isLoading={isLoading} skeleton={<MemoryCardSkeleton />} className="px-3 pb-3">
        {filteredRows.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            <div
              className="space-y-2"
              role="list"
              aria-label={localize('com_ui_tars_memory_title')}
            >
              {filteredRows.map((row) => (
                <div key={row.key} role="listitem">
                  <TarsMemoryCard
                    row={row}
                    hasUpdateAccess={hasUpdateAccess}
                    trackDialog={trackDialog}
                  />
                </div>
              ))}
            </div>
            {hasUpdateAccess && searchQuery.length === 0 && <TarsMemoryClearButton />}
          </>
        )}
      </PanelContent>

      {/* How memory behaves, apart from the search and filter that narrow the list. */}
      {!disabled && (
        <PanelFooter>
          <div className="w-full space-y-2">
            {hasOptOutAccess && (
              <div className="flex items-center justify-between gap-2">
                <span id={modeLabelId} className="text-text-primary shrink-0 text-sm">
                  {localize('com_ui_tars_memory_mode')}
                </span>
                <Dropdown
                  aria-labelledby={modeLabelId}
                  value={mode}
                  onChange={setMode}
                  options={modeOptions}
                  disabled={isSaving}
                  testId="tars-memory-mode"
                />
              </div>
            )}
            {/* Two lines reserved: the modes' texts differ in length, and the list must not move. */}
            <p className="text-text-secondary min-h-8 text-xs">{localize(INTRO_KEYS[mode])}</p>
          </div>
        </PanelFooter>
      )}
    </div>
  );
}
