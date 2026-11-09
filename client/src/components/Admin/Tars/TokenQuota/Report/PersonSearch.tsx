import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input, Label, Spinner } from '@librechat/client';
import type { TTarsTokenUser } from 'librechat-data-provider';
import { useTarsTokenUsersQuery } from '~/data-provider';
import { personIdentity } from '../helpers';
import { useLocalize } from '~/hooks';

/** Long enough that typing a name does not fire a query per keystroke. */
const DEBOUNCE_MS = 300;

/**
 * Search-as-you-type for one person, on the usage report's filter row. Picking a row
 * only selects them: the box then shows the chosen person with a clear button, and the
 * report's own search button is what loads their usage. It is independent of the group
 * filter, so anyone can be found, whether or not they belong to a group.
 */
export default function PersonSearch({
  selected,
  onSelect,
  disabled,
}: {
  selected: TTarsTokenUser | null;
  onSelect: (user: TTarsTokenUser | null) => void;
  disabled?: boolean;
}) {
  const localize = useLocalize();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: users = [], isFetching } = useTarsTokenUsersQuery(debounced, {
    enabled: open && selected == null,
  });

  const pick = (user: TTarsTokenUser) => {
    onSelect(user);
    setTerm('');
    setOpen(false);
  };

  const label = localize('com_ui_tars_report_person_search');

  if (selected != null) {
    const { primary, secondary } = personIdentity(selected, selected.id);
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="border-border-light flex h-10 items-center justify-between gap-2 rounded-md border px-3">
          <span className="min-w-0 truncate text-sm" title={secondary ?? undefined}>
            <span className="text-text-primary font-medium">{primary}</span>
            {secondary != null && (
              <span className="text-text-secondary ml-2 text-xs">{secondary}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label={localize('com_ui_clear')}
            className="text-text-secondary hover:bg-surface-hover hover:text-text-primary shrink-0 rounded-full p-1"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="tars-report-person">{label}</Label>
      <div className="relative">
        <Search
          className="text-text-secondary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="tars-report-person"
          className="pl-9"
          autoComplete="off"
          disabled={disabled}
          value={term}
          placeholder={localize('com_ui_tars_quota_user_search')}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
            }
            /** Enter belongs to the picker here, not to the report form's search. */
            if (event.key === 'Enter') {
              event.preventDefault();
            }
          }}
        />

        {open && (
          <div
            className="border-border-light bg-surface-primary absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border shadow-md"
            /* Keep focus in the input so a click on a row lands before the blur closes the list. */
            onMouseDown={(event) => event.preventDefault()}
          >
            {isFetching && (
              <div className="flex h-12 items-center justify-center">
                <Spinner className="size-4" />
              </div>
            )}
            {!isFetching && users.length === 0 && (
              <p className="text-text-secondary px-3 py-4 text-center text-sm">
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
                    onClick={() => pick(user)}
                    className="hover:bg-surface-hover flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                  >
                    <span className="min-w-0">
                      <span className="text-text-primary block truncate font-medium">
                        {primary}
                      </span>
                      {secondary != null && (
                        <span className="text-text-secondary block truncate text-xs">
                          {secondary}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
