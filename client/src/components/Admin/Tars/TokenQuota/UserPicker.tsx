import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Input, Label, Spinner } from '@librechat/client';
import type { TTarsTokenUser } from 'librechat-data-provider';
import { useTarsTokenUsersQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Long enough that typing a name does not fire a query per keystroke. */
const DEBOUNCE_MS = 300;

/**
 * Search-as-you-type picker for the personal-quota form. pwc_tars caps its
 * result at 20 rows and has no paging, so this stays a search box rather than a
 * dropdown of every account.
 */
export default function UserPicker({
  selected,
  onSelect,
}: {
  selected: TTarsTokenUser | null;
  onSelect: (user: TTarsTokenUser) => void;
}) {
  const localize = useLocalize();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: users = [], isFetching } = useTarsTokenUsersQuery(debounced);

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
          users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => onSelect(user)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-hover ${
                selected?.id === user.id ? 'bg-surface-tertiary' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-text-primary">
                  {user.display_name ?? user.username ?? user.id}
                </span>
                <span className="block truncate text-xs text-text-secondary">
                  {user.username ?? '—'}
                  {user.email == null ? '' : ` · ${user.email}`}
                </span>
              </span>
              {selected?.id === user.id && (
                <Check className="size-4 shrink-0 text-brand-primary" aria-hidden />
              )}
            </button>
          ))}
      </div>
    </div>
  );
}
