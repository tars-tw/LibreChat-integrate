import { useEffect, useMemo, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { PrincipalType } from 'librechat-data-provider';
import { Check, Search, User, Users } from 'lucide-react';
import { Alert, Button, Chip, Spinner } from '@librechat/client';
import type { TPrincipal, TPrincipalSearchResult } from 'librechat-data-provider';
import PrincipalAvatar from '~/components/Sharing/PrincipalAvatar';
import { usePrincipalDirectoryQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Rows rendered per section before the viewer narrows the list by typing. */
const SECTION_LIMIT = 50;

/** The panel renders in the dialog's flow rather than floating: a floating list is
 *  clipped by the dialog's own scroll area, while an in-flow one grows the dialog. */
const LIST_HEIGHT = 'max-h-[min(28rem,50dvh)]';

const optionKey = (principal: TPrincipalSearchResult) =>
  `${principal.type}:${principal.idOnTheSource ?? principal.id ?? principal.name}`;

const matches = (principal: TPrincipalSearchResult, needle: string) =>
  [principal.name, principal.email, principal.username, principal.description]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes(needle));

const toPrincipal = (principal: TPrincipalSearchResult): TPrincipal => ({
  type: principal.type,
  id: principal.id ?? undefined,
  name: principal.name,
  email: principal.email,
  avatar: principal.avatar,
  source: principal.source,
  description: principal.description,
  idOnTheSource: principal.idOnTheSource,
  memberCount: principal.memberCount,
});

interface DirectoryPeoplePickerProps {
  /** Receives every principal checked in the list when the viewer presses Add. */
  onAddPeople: (principals: TPrincipal[]) => void;
  /** `idOnTheSource` of principals already on the share list; they are not offered. */
  excludeIds?: (string | undefined)[];
  className?: string;
}

/**
 * The share dialog's people picker when a directory (pwc_tars) is configured: every
 * user and group is listed like an address book, several can be checked at once and
 * show as removable tags, and Add moves them onto the share list below.
 */
export default function DirectoryPeoplePicker({
  onAddPeople,
  excludeIds = [],
  className,
}: DirectoryPeoplePickerProps) {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const { data, isLoading, isError, refetch, isFetching } = usePrincipalDirectoryQuery();
  const combobox = Ariakit.useComboboxStore({
    value: query,
    setValue: setQuery,
    selectedValue: selectedKeys,
    setSelectedValue: setSelectedKeys,
  });
  const isOpen = Ariakit.useStoreState(combobox, 'open');

  /** An in-flow list has no popover to dismiss it, so a press anywhere else closes it. */
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        combobox.hide();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress, true);
  }, [isOpen, combobox]);

  const excluded = useMemo(() => new Set(excludeIds.filter(Boolean)), [excludeIds]);

  const options = useMemo(() => {
    const byKey = new Map<string, TPrincipalSearchResult>();
    for (const principal of [...(data?.groups ?? []), ...(data?.users ?? [])]) {
      if (principal.idOnTheSource && excluded.has(principal.idOnTheSource)) {
        continue;
      }
      byKey.set(optionKey(principal), principal);
    }
    return byKey;
  }, [data?.groups, data?.users, excluded]);

  /** Keys picked earlier stay only while their principal is still on offer. */
  const selected = useMemo(
    () =>
      selectedKeys
        .map((key) => options.get(key))
        .filter((principal): principal is TPrincipalSearchResult => principal != null),
    [selectedKeys, options],
  );

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups: TPrincipalSearchResult[] = [];
    const users: TPrincipalSearchResult[] = [];
    for (const principal of options.values()) {
      if (needle && !matches(principal, needle)) {
        continue;
      }
      (principal.type === PrincipalType.GROUP ? groups : users).push(principal);
    }
    return { groups, users };
  }, [options, query]);

  const removeKey = (key: string) => {
    setSelectedKeys((keys) => keys.filter((candidate) => candidate !== key));
    inputRef.current?.focus();
  };

  const handleAdd = () => {
    if (selected.length === 0) {
      return;
    }
    onAddPeople(selected.map(toPrincipal));
    setSelectedKeys([]);
    setQuery('');
    combobox.hide();
  };

  const subtitleFor = (principal: TPrincipalSearchResult) => {
    if (principal.type === PrincipalType.GROUP) {
      return localize('com_ui_share_group_member_count', { 0: principal.memberCount ?? 0 });
    }
    return principal.email || principal.username || localize('com_ui_user');
  };

  const renderSection = (
    labelKey: 'com_ui_share_directory_groups' | 'com_ui_share_directory_users',
    principals: TPrincipalSearchResult[],
  ) => {
    if (principals.length === 0) {
      return null;
    }
    const shown = principals.slice(0, SECTION_LIMIT);
    return (
      <Ariakit.ComboboxGroup className="pb-1">
        <Ariakit.ComboboxGroupLabel className="sticky top-0 z-10 border-b border-border-light bg-surface-primary px-4 py-2 text-xs font-semibold text-text-secondary">
          {localize(labelKey)} ({principals.length})
        </Ariakit.ComboboxGroupLabel>
        {shown.map((principal) => {
          const key = optionKey(principal);
          const isChecked = selectedKeys.includes(key);
          return (
            <Ariakit.ComboboxItem
              key={key}
              value={key}
              focusOnHover
              hideOnClick={false}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-text-primary',
                'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                isChecked && 'bg-surface-active-alt',
              )}
            >
              <PrincipalAvatar principal={toPrincipal(principal)} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{principal.name}</span>
                <span className="block truncate text-xs text-text-secondary">
                  {subtitleFor(principal)}
                </span>
              </span>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded border',
                  isChecked
                    ? 'border-text-primary bg-text-primary text-surface-primary'
                    : 'border-border-medium',
                )}
                aria-hidden="true"
              >
                {isChecked && <Check className="size-3.5" />}
              </span>
            </Ariakit.ComboboxItem>
          );
        })}
        {principals.length > shown.length && (
          <div className="px-4 py-2 text-xs text-text-secondary">
            {localize('com_ui_share_directory_more', { 0: principals.length - shown.length })}
          </div>
        )}
      </Ariakit.ComboboxGroup>
    );
  };

  const renderList = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-text-secondary">
          <Spinner className="size-4" />
          {localize('com_ui_loading')}
        </div>
      );
    }
    if (sections.groups.length === 0 && sections.users.length === 0) {
      return (
        <div className="px-4 py-6 text-center text-sm text-text-secondary">
          {localize('com_ui_no_results_found')}
        </div>
      );
    }
    return (
      <>
        {renderSection('com_ui_share_directory_groups', sections.groups)}
        {renderSection('com_ui_share_directory_users', sections.users)}
      </>
    );
  };

  return (
    <div ref={containerRef} className={cn('w-full space-y-2', className)}>
      <Ariakit.ComboboxProvider store={combobox}>
        <Ariakit.ComboboxLabel className="sr-only">
          {localize('com_ui_search_people_placeholder')}
        </Ariakit.ComboboxLabel>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div
            className="flex min-h-10 min-w-0 flex-1 cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-border-light bg-surface-primary px-3 py-1.5 focus-within:border-border-heavy"
            onClick={() => inputRef.current?.focus()}
          >
            {isFetching && !data ? (
              <Spinner className="size-4 shrink-0" />
            ) : (
              <Search className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            )}
            {selected.map((principal) => {
              const key = optionKey(principal);
              const isGroup = principal.type === PrincipalType.GROUP;
              return (
                <Chip
                  key={key}
                  tone={isGroup ? 'info' : 'neutral'}
                  className="max-w-[14rem]"
                  leading={
                    isGroup ? (
                      <Users className="size-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <User className="size-3 shrink-0" aria-hidden="true" />
                    )
                  }
                  removeLabel={localize('com_ui_share_remove_selected', { 0: principal.name })}
                  onRemove={() => removeKey(key)}
                  data-testid="directory-picker-chip"
                >
                  {principal.name}
                </Chip>
              );
            })}
            <Ariakit.Combobox
              ref={inputRef}
              autoSelect
              showOnClick
              placeholder={
                selected.length === 0 ? localize('com_ui_search_people_placeholder') : undefined
              }
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && query === '' && selectedKeys.length > 0) {
                  setSelectedKeys((keys) => keys.slice(0, -1));
                }
                /** Escape closes the list first, and only an already closed list lets
                 *  it through to close the dialog. */
                if (event.key === 'Escape' && isOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  combobox.hide();
                }
                if (event.key === 'Tab') {
                  combobox.hide();
                }
              }}
              className="h-7 min-w-[8rem] flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleAdd}
            disabled={selected.length === 0}
            className="h-10 shrink-0"
            data-testid="directory-picker-add"
          >
            {selected.length > 0
              ? localize('com_ui_share_add_selected', { 0: selected.length })
              : localize('com_ui_add')}
          </Button>
        </div>
        {isOpen && (
          <div
            className="overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-sm"
            data-testid="directory-picker-panel"
          >
            <Ariakit.ComboboxList
              alwaysVisible
              className={cn('overflow-y-auto overscroll-contain', LIST_HEIGHT)}
            >
              {renderList()}
            </Ariakit.ComboboxList>
            <div className="flex items-center justify-between gap-2 border-t border-border-light bg-surface-secondary px-4 py-2">
              <span className="text-xs text-text-secondary">
                {localize('com_ui_selected_count', { count: selected.length })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedKeys([])}
                  disabled={selected.length === 0}
                >
                  {localize('com_ui_clear')}
                </Button>
                <Button
                  type="button"
                  variant="submit"
                  size="sm"
                  onClick={handleAdd}
                  disabled={selected.length === 0}
                  data-testid="directory-picker-panel-add"
                >
                  {selected.length > 0
                    ? localize('com_ui_share_add_selected', { 0: selected.length })
                    : localize('com_ui_add')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Ariakit.ComboboxProvider>
      {isError && (
        <Alert variant="error">
          <div className="flex items-center justify-between gap-2">
            <span>{localize('com_ui_share_directory_error')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              {localize('com_ui_retry')}
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}
