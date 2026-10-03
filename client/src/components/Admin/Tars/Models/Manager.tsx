import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import {
  Input,
  Button,
  Switch,
  Spinner,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
} from '@librechat/client';
import type { TTarsModelProfile } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useTarsModelProfilesQuery,
  useDeleteTarsModelProfileMutation,
  useUpdateTarsModelProfileMutation,
} from '~/data-provider';
import { collectModelTypes, displayDescription, isProfileEnabled } from './helpers';
import { formatDateTime } from '../Users/helpers';
import ModelProfileModal from './Modal';
import useFeedback from './useFeedback';
import { useLocalize } from '~/hooks';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

/** Filter sentinel: `Dropdown` needs a real option value for "no filter". */
const ALL = 'all';
const ENABLED = 'enabled';
const DISABLED = 'disabled';

type SortField = 'name' | 'type' | 'status' | 'updated_at';

const compareText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });

const timeOf = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};

const compareBy = (field: SortField, a: TTarsModelProfile, b: TTarsModelProfile): number => {
  switch (field) {
    case 'type':
      return compareText(a.type, b.type) || compareText(a.name, b.name);
    case 'status':
      return Number(b.status) - Number(a.status) || compareText(a.name, b.name);
    case 'updated_at':
      return timeOf(a.updated_at ?? a.created_at) - timeOf(b.updated_at ?? b.created_at);
    default:
      return compareText(a.name, b.name);
  }
};

/** A cell that keeps one line and shows the full value on hover. */
function Truncated({ value, className = '' }: { value: string; className?: string }) {
  if (!value) {
    return <span className="text-text-secondary">—</span>;
  }
  return (
    <span title={value} className={`block truncate ${className}`}>
      {value}
    </span>
  );
}

export default function ModelProfileManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { notifySuccess, notifyError } = useFeedback();

  const { data: profiles = [], isLoading, isError } = useTarsModelProfilesQuery();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsModelProfile | null>(null);
  const [deleting, setDeleting] = useState<TTarsModelProfile | null>(null);
  const [disabling, setDisabling] = useState<TTarsModelProfile | null>(null);

  const types = useMemo(() => collectModelTypes(profiles), [profiles]);
  const typeOptions = useMemo(
    () => [{ value: ALL, label: localize('com_ui_tars_models_filter_type_all') }, ...types],
    [types, localize],
  );
  const statusOptions = useMemo(
    () => [
      { value: ALL, label: localize('com_ui_tars_models_filter_status_all') },
      { value: ENABLED, label: localize('com_ui_tars_users_enabled') },
      { value: DISABLED, label: localize('com_ui_tars_users_disabled') },
    ],
    [localize],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = profiles.filter((profile) => {
      if (typeFilter !== ALL && profile.type !== typeFilter) {
        return false;
      }
      if (statusFilter !== ALL && isProfileEnabled(profile) !== (statusFilter === ENABLED)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        profile.name,
        profile.type,
        profile.version,
        profile.endpoint,
        displayDescription(profile.description, i18n.language),
      ].some((field) => field?.toLowerCase().includes(query));
    });
    return matched.sort((a, b) => {
      const compared = compareBy(sortField, a, b);
      return sortAsc ? compared : -compared;
    });
  }, [profiles, search, typeFilter, statusFilter, sortField, sortAsc, i18n.language]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  );

  const toggleMutation = useUpdateTarsModelProfileMutation({
    onSuccess: ({ profile, sync }) => {
      notifySuccess(
        localize(
          isProfileEnabled(profile)
            ? 'com_ui_tars_models_enabled_toast'
            : 'com_ui_tars_models_disabled_toast',
          { name: profile.name },
        ),
        sync,
      );
      setDisabling(null);
    },
    onError: notifyError,
  });
  const togglingId = toggleMutation.isLoading ? toggleMutation.variables?.id : undefined;

  const deleteMutation = useDeleteTarsModelProfileMutation({
    onSuccess: ({ sync }) => {
      notifySuccess(localize('com_ui_tars_models_deleted'), sync);
      setDeleting(null);
    },
    onError: notifyError,
  });

  /** Enabling is harmless; disabling moves other settings off the model, so it asks first. */
  const handleToggle = (profile: TTarsModelProfile, enabled: boolean) => {
    if (enabled) {
      toggleMutation.mutate({ id: profile.id, data: { enabled: true } });
      return;
    }
    setDisabling(profile);
  };

  /** Dates read best newest-first, so that column starts descending. */
  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(field !== 'updated_at');
  };

  const sortableHeader = (field: SortField, labelKey: TranslationKeys, className = '') => (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className="flex items-center gap-1 hover:text-text-primary"
      >
        {localize(labelKey)}
        {field === sortField &&
          (sortAsc ? <ChevronUp className="icon-xs" /> : <ChevronDown className="icon-xs" />)}
      </button>
    </th>
  );

  const resetPage =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(0);
    };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-96 max-w-full">
            <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              value={search}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
              placeholder={localize('com_ui_tars_models_search')}
              aria-label={localize('com_ui_tars_models_search')}
              className="pl-9 placeholder:text-text-muted"
            />
          </div>
          <Button variant="submit" onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_models_add')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            value={typeFilter}
            onChange={resetPage(setTypeFilter)}
            options={typeOptions}
            ariaLabel={localize('com_ui_tars_models_filter_type')}
            sizeClasses="min-w-[9rem]"
          />
          <Dropdown
            value={statusFilter}
            onChange={resetPage(setStatusFilter)}
            options={statusOptions}
            ariaLabel={localize('com_ui_tars_models_filter_status')}
            sizeClasses="min-w-[8rem]"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && isError && (
        <p className="py-12 text-center text-sm text-text-destructive">
          {localize('com_ui_tars_models_load_failed')}
        </p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_models_empty')}
        </p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[72rem] table-fixed text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  {sortableHeader('name', 'com_ui_tars_models_name', 'w-[14%]')}
                  <th className="w-[7%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_models_version')}
                  </th>
                  {sortableHeader('type', 'com_ui_tars_models_type', 'w-[10%]')}
                  <th className="w-[19%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_models_endpoint')}
                  </th>
                  <th className="w-[10%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_models_api_version')}
                  </th>
                  <th className="w-[17%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_models_description')}
                  </th>
                  {sortableHeader('status', 'com_ui_tars_users_status', 'w-[9%]')}
                  {sortableHeader('updated_at', 'com_ui_tars_models_updated_at', 'w-[9%]')}
                  <th className="w-[5%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((profile) => {
                  const enabled = isProfileEnabled(profile);
                  return (
                    <tr
                      key={profile.id}
                      className="border-t border-border-light hover:bg-surface-hover"
                    >
                      <td className="px-3 py-2 font-medium text-text-primary">
                        <Truncated value={profile.name} />
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        <Truncated value={profile.version ?? ''} />
                      </td>
                      <td className="px-3 py-2">
                        {profile.type ? (
                          <span
                            title={profile.type}
                            className="inline-block max-w-full truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-primary"
                          >
                            {profile.type}
                          </span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        <Truncated value={profile.endpoint ?? ''} className="font-mono text-xs" />
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        <Truncated
                          value={profile.api_version ?? ''}
                          className="font-mono text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        <Truncated value={displayDescription(profile.description, i18n.language)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={localize('com_ui_tars_models_toggle', {
                              name: profile.name,
                            })}
                            checked={enabled}
                            disabled={togglingId === profile.id}
                            onCheckedChange={(checked) => handleToggle(profile, checked)}
                          />
                          {togglingId === profile.id ? (
                            <Spinner className="icon-sm" />
                          ) : (
                            <span className="text-xs text-text-secondary">
                              {enabled
                                ? localize('com_ui_tars_users_enabled')
                                : localize('com_ui_tars_users_disabled')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-text-secondary">
                        {formatDateTime(profile.updated_at ?? profile.created_at, i18n.language) ||
                          '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            aria-label={localize('com_ui_edit')}
                            title={localize('com_ui_edit')}
                            onClick={() => setEditing(profile)}
                            className="rounded p-1.5 text-text-secondary hover:text-text-primary"
                          >
                            <Pencil className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_delete')}
                            title={localize('com_ui_delete')}
                            onClick={() => setDeleting(profile)}
                            className="rounded p-1.5 text-text-destructive hover:text-text-destructive"
                          >
                            <Trash2 className="icon-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-models-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-models-page-size-label"
                sizeClasses="min-w-[5rem]"
              />
              <span>{localize('com_ui_tars_models_total', { count: filtered.length })}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>
                {localize('com_ui_tars_users_page_of', {
                  current: currentPage + 1,
                  total: pageCount,
                })}
              </span>
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {localize('com_ui_tars_users_prev_page')}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {localize('com_ui_tars_users_next_page')}
              </Button>
            </div>
          </div>
        </>
      )}

      {(creating || editing != null) && (
        <ModelProfileModal
          key={editing?.id ?? 'create'}
          profile={editing ?? undefined}
          profiles={profiles}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {disabling != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDisabling(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_models_disable')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_models_disable_confirm', { name: disabling.name })}
                </p>
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_models_cascade_warning')}
                </p>
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() =>
                  toggleMutation.mutate({ id: disabling.id, data: { enabled: false } })
                }
                disabled={toggleMutation.isLoading}
              >
                {toggleMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_tars_models_disable_action')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_models_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_models_delete_confirm', { name: deleting.name })}
                </p>
                {isProfileEnabled(deleting) && (
                  <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                    {localize('com_ui_tars_models_cascade_warning')}
                  </p>
                )}
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
