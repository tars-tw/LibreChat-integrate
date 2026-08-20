import { useMemo, useState } from 'react';
import { Input, Button, Spinner, Dropdown } from '@librechat/client';
import { Search, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import type { TTarsSysConfig } from 'librechat-data-provider';
import { isSysConfigActive, maskSysConfigValue } from './helpers';
import { useTarsSysConfigsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import SysConfigModal from './Modal';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

type SortField = 'key' | 'category' | 'description';

export default function SysConfigManager() {
  const localize = useLocalize();
  const { data: sysConfigs = [], isLoading } = useTarsSysConfigsQuery();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('key');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [editing, setEditing] = useState<TTarsSysConfig | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = !query
      ? sysConfigs
      : sysConfigs.filter((config) =>
          [config.key, config.category, config.description]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
        );
    return [...matched].sort((a, b) => {
      const compared = (a[sortField] ?? '')
        .toLowerCase()
        .localeCompare((b[sortField] ?? '').toLowerCase());
      return sortAsc ? compared : -compared;
    });
  }, [sysConfigs, search, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  );

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(true);
  };

  const sortableHeader = (
    field: SortField,
    labelKey: Parameters<typeof localize>[0],
    width: string,
  ) => (
    <th className={`${width} px-3 py-2 font-medium`}>
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64 max-w-full">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={localize('com_ui_tars_sys_config_search')}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_sys_config_empty')}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[60rem] table-fixed text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  {sortableHeader('key', 'com_ui_tars_sys_config_key', 'w-[22%]')}
                  {sortableHeader('category', 'com_ui_tars_sys_config_category', 'w-[12%]')}
                  <th className="w-[24%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_sys_config_value')}
                  </th>
                  {sortableHeader('description', 'com_ui_tars_sys_config_description', 'w-[24%]')}
                  <th className="w-[10%] px-3 py-2 font-medium">
                    {localize('com_ui_tars_sys_config_status')}
                  </th>
                  <th className="w-[8%] px-3 py-2 text-right font-medium">
                    {localize('com_ui_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((config) => (
                  <tr
                    key={config.id}
                    className="border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="px-3 py-2">
                      <span
                        className="block truncate font-medium text-text-primary"
                        title={config.key}
                      >
                        {config.key}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      <span className="block truncate" title={config.category ?? ''}>
                        {config.category ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate font-mono text-xs text-text-secondary">
                        {maskSysConfigValue(config) || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      <span className="block truncate" title={config.description ?? ''}>
                        {config.description ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                          isSysConfigActive(config)
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                            : 'bg-surface-tertiary text-text-secondary'
                        }`}
                      >
                        {isSysConfigActive(config)
                          ? localize('com_ui_tars_sys_config_active')
                          : localize('com_ui_tars_sys_config_inactive')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label={localize('com_ui_tars_sys_config_edit')}
                          title={localize('com_ui_tars_sys_config_edit')}
                          onClick={() => setEditing(config)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Pencil className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-sys-config-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-sys-config-page-size-label"
                sizeClasses="min-w-[5rem]"
              />
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

      {editing != null && (
        <SysConfigModal
          key={editing.id}
          config={editing}
          open={true}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </div>
  );
}
