import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input, Label, Spinner } from '@librechat/client';
import type { TTarsTokenUser } from 'librechat-data-provider';
import { useTarsTokenUsersQuery } from '~/data-provider';
import { personIdentity } from './helpers';
import { useLocalize } from '~/hooks';

/** Long enough that typing a name does not fire a query per keystroke. */
const DEBOUNCE_MS = 300;

/**
 * Search-as-you-type picker for the personal-quota form, single-select: picking
 * a row replaces `selected` rather than adding to it. The search list collapses
 * into a summary card on a pick so it reads as "one user chosen," not as a list
 * left open for more clicks; the card's clear button is the only way back into
 * search, mirroring the read-only user card `QuotaModal` shows once a quota
 * already has a fixed owner.
 */
export default function UserPicker({
  selected,
  onSelect,
}: {
  selected: TTarsTokenUser | null;
  onSelect: (user: TTarsTokenUser | null) => void;
}) {
  const localize = useLocalize();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: users = [], isFetching } = useTarsTokenUsersQuery(debounced);

  if (selected != null) {
    const { primary, secondary } = personIdentity(selected, selected.id);
    return (
      <div className="space-y-1.5">
        <Label>{localize('com_ui_tars_quota_col_user')}</Label>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate font-medium text-text-primary">{primary}</span>
            {secondary != null && (
              <span className="block truncate text-xs text-text-secondary">{secondary}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setTerm('');
              onSelect(null);
            }}
            aria-label={localize('com_ui_clear')}
            className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="tars-quota-user">{localize('com_ui_tars_quota_col_user')}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
        <Input
          id="tars-quota-user"
          className="pl-9"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={localize('com_ui_tars_quota_user_search')}
        />
      </div>

      <div className="max-h-48 overflow-y-auto rounded-lg border border-border-light">
        {isFetching && (
          <div className="flex h-16 items-center justify-center">
            <Spinner className="size-4" />
          </div>
        )}
        {!isFetching && users.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_audit_no_data')}
          </p>
        )}
        {!isFetching &&
          users.map((user) => {
            const { primary, secondary } = personIdentity(user, user.id);
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => onSelect(user)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-hover"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-primary">{primary}</span>
                  {secondary != null && (
                    <span className="block truncate text-xs text-text-secondary">{secondary}</span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
