import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Input,
  Button,
  Spinner,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import {
  Plus,
  Book,
  List,
  Globe,
  Search,
  Pencil,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
  LayoutGrid,
} from 'lucide-react';
import type { TTarsDomain } from 'librechat-data-provider';
import { useDeleteTarsDomainMutation, useTarsDomainPrepareDataQuery } from '~/data-provider';
import { toNameMap, toCsvBlob, downloadBlob, formatDateTime } from '../Users/helpers';
import { domainKnowledgeBaseIds, domainRoleIds, isIframeDomain } from './helpers';
import { StatusBadge, NameList } from '../Users/Fields';
import { useLocalize } from '~/hooks';
import DomainModal from './Modal';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

type SortField = 'name' | 'description';
type ViewMode = 'grid' | 'table';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

export default function DomainManager() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const { data, isLoading } = useTarsDomainPrepareDataQuery();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsDomain | null>(null);
  const [deleting, setDeleting] = useState<TTarsDomain | null>(null);

  const domains = useMemo(() => data?.sys_domains ?? [], [data?.sys_domains]);
  const roles = useMemo(() => data?.roles ?? [], [data?.roles]);
  const knowledgeBases = useMemo(() => data?.knowledge_bases ?? [], [data?.knowledge_bases]);
  const kbNames = useMemo(() => toNameMap(knowledgeBases), [knowledgeBases]);
  const roleNames = useMemo(() => toNameMap(roles), [roles]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = !query
      ? domains
      : domains.filter((domain) =>
          [domain.name, domain.description]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
        );
    return [...matched].sort((a, b) => {
      const compared = (a[sortField] ?? '')
        .toString()
        .localeCompare((b[sortField] ?? '').toString(), 'zh-Hant');
      return sortAsc ? compared : -compared;
    });
  }, [domains, search, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  /** Grid mode shows every match; only the table paginates, as in pwc_tars. */
  const rows = useMemo(
    () =>
      viewMode === 'grid'
        ? filtered
        : filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, viewMode, currentPage, pageSize],
  );

  const deleteMutation = useDeleteTarsDomainMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_domain_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const kbLabels = (domain: TTarsDomain): string[] =>
    domainKnowledgeBaseIds(domain)
      .map((id) => kbNames.get(id))
      .filter((name): name is string => !!name);

  const roleLabels = (domain: TTarsDomain): string[] =>
    domainRoleIds(domain, roles)
      .map((id) => roleNames.get(id))
      .filter((name): name is string => !!name);

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(true);
  };

  const handleExport = () => {
    const headers = [
      localize('com_ui_tars_domain_name'),
      localize('com_ui_description'),
      localize('com_ui_tars_knowledge_bases'),
      localize('com_ui_tars_domain_roles'),
      localize('com_ui_tars_domain_iframe_url'),
      localize('com_ui_tars_users_status'),
      localize('com_ui_tars_users_created_at'),
    ];
    const csvRows = filtered.map((domain) => [
      domain.name,
      domain.description ?? '',
      kbLabels(domain).join(' / '),
      roleLabels(domain).join(' / '),
      domain.iframe_url ?? '',
      domain.status
        ? localize('com_ui_tars_users_enabled')
        : localize('com_ui_tars_users_disabled'),
      formatDateTime(domain.created_at, i18n.language),
    ]);
    downloadBlob(
      toCsvBlob(headers, csvRows),
      `TARS_domains_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const actionButtons = (domain: TTarsDomain) => (
    <div className="flex items-center gap-1">
      {!isIframeDomain(domain) && (
        <button
          type="button"
          aria-label={localize('com_ui_tars_domain_prompts')}
          title={localize('com_ui_tars_domain_prompts')}
          onClick={() => navigate('/prompts')}
          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
        >
          <Book className="icon-sm" />
        </button>
      )}
      <button
        type="button"
        aria-label={localize('com_ui_edit')}
        title={localize('com_ui_edit')}
        onClick={() => setEditing(domain)}
        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
      >
        <Pencil className="icon-sm" />
      </button>
      <button
        type="button"
        aria-label={localize('com_ui_delete')}
        title={localize('com_ui_delete')}
        onClick={() => setDeleting(domain)}
        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
      >
        <Trash2 className="icon-sm" />
      </button>
    </div>
  );

  const sortableHeader = (field: SortField, labelKey: Parameters<typeof localize>[0]) => (
    <th className="px-3 py-2 font-medium">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={localize('com_ui_tars_domain_search')}
              className="pl-9"
            />
          </div>
          <Button variant="submit" onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_domain_add')}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="icon-sm mr-1" />
            {localize('com_ui_tars_users_export_csv')}
          </Button>
          <div
            role="group"
            aria-label={localize('com_ui_tars_domain_view_mode')}
            className="flex rounded-lg border border-border-light"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'grid'}
              aria-label={localize('com_ui_tars_domain_view_grid')}
              title={localize('com_ui_tars_domain_view_grid')}
              onClick={() => setViewMode('grid')}
              className={`rounded-l-lg p-2 ${
                viewMode === 'grid'
                  ? 'bg-surface-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <LayoutGrid className="icon-sm" />
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'table'}
              aria-label={localize('com_ui_tars_domain_view_table')}
              title={localize('com_ui_tars_domain_view_table')}
              onClick={() => setViewMode('table')}
              className={`rounded-r-lg p-2 ${
                viewMode === 'table'
                  ? 'bg-surface-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <List className="icon-sm" />
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_domain_empty')}
        </p>
      )}

      {!isLoading && filtered.length > 0 && viewMode === 'grid' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((domain) => (
            <div
              key={domain.id}
              className="flex flex-col gap-2 rounded-xl border border-border-light p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isIframeDomain(domain) && (
                      <Globe className="icon-sm text-text-secondary" aria-hidden="true" />
                    )}
                    <span className="truncate font-medium text-text-primary" title={domain.name}>
                      {domain.name}
                    </span>
                  </div>
                  <p className="truncate text-sm text-text-secondary">
                    {domain.description || '—'}
                  </p>
                </div>
                <StatusBadge active={!!domain.status} />
              </div>
              <div className="text-xs text-text-secondary">
                {isIframeDomain(domain) ? (
                  <span className="block truncate" title={domain.iframe_url ?? ''}>
                    {domain.iframe_url}
                  </span>
                ) : (
                  <NameList
                    names={kbLabels(domain)}
                    empty={localize('com_ui_tars_domain_kb_none')}
                  />
                )}
              </div>
              <div className="mt-auto flex justify-end">{actionButtons(domain)}</div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && filtered.length > 0 && viewMode === 'table' && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  {sortableHeader('name', 'com_ui_tars_domain_name')}
                  {sortableHeader('description', 'com_ui_description')}
                  <th className="px-3 py-2 font-medium">
                    {localize('com_ui_tars_domain_kb_or_iframe')}
                  </th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_domain_roles')}</th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_status')}</th>
                  <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((domain) => (
                  <tr
                    key={domain.id}
                    className="border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="px-3 py-2 text-text-primary">
                      <div className="flex items-center gap-2">
                        {isIframeDomain(domain) && (
                          <Globe className="icon-xs text-text-secondary" aria-hidden="true" />
                        )}
                        {domain.name}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{domain.description || '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {isIframeDomain(domain) ? (
                        <span className="block max-w-xs truncate" title={domain.iframe_url ?? ''}>
                          {domain.iframe_url}
                        </span>
                      ) : (
                        <NameList
                          names={kbLabels(domain)}
                          empty={localize('com_ui_tars_domain_kb_none')}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      <NameList
                        names={roleLabels(domain)}
                        empty={localize('com_ui_tars_users_unassigned')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge active={!!domain.status} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">{actionButtons(domain)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-domains-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-domains-page-size-label"
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

      {(creating || editing != null) && (
        <DomainModal
          key={editing?.id ?? 'create'}
          open={true}
          domain={editing ?? undefined}
          roles={roles}
          knowledgeBases={knowledgeBases}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_domain_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_domain_delete_confirm', { name: deleting.name })}
                </p>
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_domain_delete_warning')}
                </p>
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
