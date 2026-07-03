import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Spinner } from '@librechat/client';
import { Search, Pencil, ArrowUpDown } from 'lucide-react';
import type { TTarsSysConfig } from 'librechat-data-provider';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import { useTarsSysConfigsQuery } from '~/data-provider';
import EditSysConfigModal from './EditSysConfigModal';

type SortColumn = 'key' | 'category';
type SortState = { column: SortColumn; direction: 'asc' | 'desc' };

const SECRET_KEY_PATTERN = /KEY|API/i;

/** Masks secret values in the table; the edit dialog shows the full value. */
export function maskSysConfigValue(config: TTarsSysConfig): string {
  const value = config.value ?? '';
  if (!value || !SECRET_KEY_PATTERN.test(config.key)) {
    return value;
  }
  if (value.length <= 8) {
    return '••••••';
  }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export default function SystemConfigView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();
  const { data: sysConfigs = [], isLoading } = useTarsSysConfigsQuery();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: 'key', direction: 'asc' });
  const [editing, setEditing] = useState<TTarsSysConfig | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? sysConfigs.filter((config) =>
          [config.key, config.category, config.description]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(q)),
        )
      : sysConfigs;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort(
      (a, b) => factor * (a[sort.column] ?? '').localeCompare(b[sort.column] ?? ''),
    );
  }, [sysConfigs, search, sort]);

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  const toggleSort = (column: SortColumn) =>
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_tars_sys_config')}
        </h1>

        <div className="relative max-w-sm">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={localize('com_ui_tars_sys_config_search')}
            className="pl-9"
          />
        </div>

        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="py-12 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_sys_config_empty')}
          </p>
        )}
        {!isLoading && rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border-light">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  <th className="w-[22%] px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('key')}
                      className="flex items-center gap-1 hover:text-text-primary"
                    >
                      {localize('com_ui_tars_sys_config_key')}
                      <ArrowUpDown className="icon-xs" />
                    </button>
                  </th>
                  <th className="w-[12%] px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('category')}
                      className="flex items-center gap-1 hover:text-text-primary"
                    >
                      {localize('com_ui_tars_sys_config_category')}
                      <ArrowUpDown className="icon-xs" />
                    </button>
                  </th>
                  <th className="w-[24%] px-4 py-2 font-medium">
                    {localize('com_ui_tars_sys_config_value')}
                  </th>
                  <th className="w-[24%] px-4 py-2 font-medium">
                    {localize('com_ui_tars_sys_config_description')}
                  </th>
                  <th className="w-[10%] px-4 py-2 font-medium">
                    {localize('com_ui_tars_sys_config_status')}
                  </th>
                  <th className="w-[8%] px-4 py-2 text-right font-medium">
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
                    <td className="px-4 py-2">
                      <span
                        className="block truncate font-medium text-text-primary"
                        title={config.key}
                      >
                        {config.key}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      <span className="block truncate" title={config.category ?? ''}>
                        {config.category ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="block truncate font-mono text-xs text-text-secondary">
                        {maskSysConfigValue(config) || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      <span className="block truncate" title={config.description ?? ''}>
                        {config.description ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                          config.status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                            : 'bg-surface-tertiary text-text-secondary'
                        }`}
                      >
                        {config.status === 'active'
                          ? localize('com_ui_tars_sys_config_active')
                          : localize('com_ui_tars_sys_config_inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label={localize('com_ui_tars_sys_config_edit')}
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
        )}
      </div>

      {editing && (
        <EditSysConfigModal
          config={editing}
          open={editing != null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </div>
  );
}
