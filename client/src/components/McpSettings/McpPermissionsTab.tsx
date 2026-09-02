import { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button, Spinner, Checkbox, useToastContext } from '@librechat/client';
import type { TTarsMcpTool, TTarsMcpServer } from 'librechat-data-provider';
import {
  useTarsMcpServerQuery,
  useTarsMcpServersQuery,
  useSaveTarsDomainMcpMutation,
  useTarsDomainMcpServersQuery,
  useTarsDomainPrepareDataQuery,
} from '~/data-provider';
import Picker, { type PickerOption } from '~/components/Admin/Tars/Audit/Picker';
import { useLocalize } from '~/hooks';

/** Selection state: serverId → checked toolId set; empty set = whole server (`mcp_tool_ids: []`). */
type Selection = Map<string, Set<string>>;
type ToggleTool = (
  serverId: string,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
) => void;

const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);
/** Checkbox gutter, flexible name column, fixed tool-count column — shared by the header and every row so columns line up. */
const PERMISSIONS_ROW_GRID = 'grid grid-cols-[2.5rem_1fr_5rem] items-center gap-2 px-3 py-2';

function PermissionServerRow({
  server,
  checkedTools,
  isExpanded,
  onToggleExpanded,
  onToggleServer,
  onToggleTool,
}: {
  server: TTarsMcpServer;
  checkedTools: Set<string> | undefined;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleServer: (checked: boolean) => void;
  onToggleTool: ToggleTool;
}) {
  const localize = useLocalize();
  const { data: detail, isLoading } = useTarsMcpServerQuery(isExpanded ? server.id : null);
  const tools: TTarsMcpTool[] = detail?.tools ?? [];
  const isServerChecked = checkedTools != null;
  const allToolIds = tools.map((tool) => tool.id);
  let selectionLabel = '';
  if (isServerChecked) {
    selectionLabel =
      (checkedTools?.size ?? 0) > 0
        ? localize('com_ui_tars_mcp_tools_selected', { count: checkedTools?.size ?? 0 })
        : localize('com_ui_tars_mcp_all_tools');
  }

  return (
    <div className="border-b border-border-light last:border-b-0">
      <div
        className={`${PERMISSIONS_ROW_GRID} ${
          isServerChecked ? 'bg-brand-primary-subtle/40' : 'hover:bg-surface-hover'
        }`}
      >
        <Checkbox
          aria-label={server.name}
          checked={isServerChecked}
          onCheckedChange={(checked) => onToggleServer(checked === true)}
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          className="flex min-w-0 items-center gap-2 rounded py-0.5 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="icon-sm shrink-0 text-brand-primary" />
          ) : (
            <ChevronRight className="icon-sm shrink-0 text-text-secondary" />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${isServerChecked ? 'text-brand-primary' : 'text-text-primary'}`}
          >
            {server.name}
          </span>
          <span
            className={`shrink-0 whitespace-nowrap text-xs ${isServerChecked ? 'text-brand-primary' : 'text-text-secondary'}`}
          >
            {selectionLabel}
          </span>
        </button>
        <span className="text-right text-xs text-text-secondary">{server.tool_count ?? 0}</span>
      </div>
      {isExpanded && (
        <ul className="space-y-1 bg-surface-secondary px-4 py-2 sm:px-6">
          {isLoading && (
            <li>
              <Spinner className="icon-sm" />
            </li>
          )}
          {!isLoading &&
            tools.map((tool) => {
              const isToolChecked =
                isServerChecked &&
                ((checkedTools?.size ?? 0) === 0 || checkedTools?.has(tool.id) === true);
              return (
                <li key={tool.id}>
                  <div className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-surface-hover">
                    <Checkbox
                      aria-label={tool.name}
                      checked={isToolChecked}
                      onCheckedChange={(checked) =>
                        onToggleTool(server.id, allToolIds, tool.id, checked === true)
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${
                          isToolChecked
                            ? 'bg-brand-primary-subtle text-brand-primary'
                            : 'bg-surface-tertiary text-text-primary'
                        }`}
                      >
                        {tool.name}
                      </span>
                      {tool.description != null && tool.description !== '' && (
                        <p className="mt-1 whitespace-normal break-words text-xs text-text-secondary">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          {!isLoading && tools.length === 0 && (
            <li className="text-xs text-text-secondary">{localize('com_ui_tars_mcp_no_tools')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Domain↔MCP binding editor mirroring pwc_tars's 權限設定 tab: pick domains,
 * check servers/tools, save via the full-overwrite `POST domains/save` proxy.
 */
export default function McpPermissionsTab() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: prepareData, isLoading: domainsLoading } = useTarsDomainPrepareDataQuery();
  const { data: servers = [], isLoading: serversLoading } = useTarsMcpServersQuery();

  const [selectedDomainIds, setSelectedDomainIds] = useState<Set<number>>(new Set());
  const [selection, setSelection] = useState<Selection>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const domains = useMemo(() => prepareData?.sys_domains ?? [], [prepareData]);
  const managedServers = useMemo(
    () => servers.filter((server) => MANAGED_TYPES.has(server.type)),
    [servers],
  );
  const domainOptions: PickerOption[] = useMemo(
    () => domains.map((domain) => ({ value: String(domain.id), label: domain.name })),
    [domains],
  );
  const selectedDomains = useMemo(
    () => domains.filter((domain) => selectedDomainIds.has(domain.id)),
    [domains, selectedDomainIds],
  );

  const singleDomainId = selectedDomainIds.size === 1 ? [...selectedDomainIds][0] : null;
  const { data: existingRelations } = useTarsDomainMcpServersQuery(singleDomainId);

  useEffect(() => {
    if (singleDomainId == null || existingRelations == null) {
      return;
    }
    const next: Selection = new Map();
    for (const relation of existingRelations) {
      if (!relation.is_enabled) {
        continue;
      }
      next.set(relation.mcp_server_id, new Set(relation.mcp_tool_ids ?? []));
    }
    setSelection(next);
  }, [singleDomainId, existingRelations]);

  const applyDomainSelection = (ids: number[]) => {
    const next = new Set(ids);
    setSelectedDomainIds(next);
    /** No domain selected — the checked servers/tools belonged to the deselected one. */
    if (next.size === 0) {
      setSelection(new Map());
    }
  };

  const handleDomainSelectionChange = (values: string[]) =>
    applyDomainSelection(values.map(Number));

  const removeDomain = (domainId: number) =>
    applyDomainSelection([...selectedDomainIds].filter((id) => id !== domainId));

  const toggleServer = useCallback((serverId: string, checked: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(serverId, new Set());
      } else {
        next.delete(serverId);
      }
      return next;
    });
  }, []);

  const toggleTool = useCallback<ToggleTool>((serverId, allToolIds, toolId, checked) => {
    setSelection((prev) => {
      const next = new Map(prev);
      const current = next.get(serverId);
      /** An empty stored set means "whole server", so expand it before editing. */
      const effective = new Set(current == null || current.size === 0 ? allToolIds : current);
      if (checked) {
        effective.add(toolId);
      } else {
        effective.delete(toolId);
      }
      if (effective.size === 0) {
        next.delete(serverId);
      } else if (effective.size === allToolIds.length) {
        next.set(serverId, new Set());
      } else {
        next.set(serverId, effective);
      }
      return next;
    });
  }, []);

  const toggleExpanded = (serverId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const saveMutation = useSaveTarsDomainMcpMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_mcp_permissions_saved'), status: 'success' }),
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  const handleSave = () => {
    if (selectedDomainIds.size === 0) {
      showToast({ message: localize('com_ui_tars_mcp_domain_required'), status: 'error' });
      return;
    }
    saveMutation.mutate({
      domain_ids: [...selectedDomainIds],
      servers: [...selection.entries()].map(([serverId, toolIds]) => ({
        mcp_server_id: serverId,
        mcp_tool_ids: [...toolIds],
      })),
    });
  };

  if (domainsLoading || serversLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        {domains.length === 0 ? (
          <p className="text-sm text-text-secondary">{localize('com_ui_tars_mcp_no_domains')}</p>
        ) : (
          <Picker
            id="tars-mcp-permissions-domain-picker"
            label={localize('com_ui_tars_mcp_select_domains')}
            options={domainOptions}
            selected={[...selectedDomainIds].map(String)}
            onChange={handleDomainSelectionChange}
            placeholder={localize('com_ui_tars_mcp_domain_placeholder')}
          />
        )}
        {selectedDomains.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedDomains.map((domain) => (
              <span
                key={domain.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary bg-brand-primary-subtle px-3 py-1 text-sm text-brand-primary"
              >
                {domain.name}
                <button
                  type="button"
                  onClick={() => removeDomain(domain.id)}
                  aria-label={localize('com_ui_tars_mcp_domain_remove', { name: domain.name })}
                  className="rounded-full hover:bg-brand-primary/20"
                >
                  <X className="icon-sm" />
                </button>
              </span>
            ))}
          </div>
        )}
        {selectedDomainIds.size > 1 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {localize('com_ui_tars_mcp_multi_domain_warning')}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-light">
        <div
          className={`${PERMISSIONS_ROW_GRID} border-b border-border-light bg-surface-secondary text-xs font-medium text-text-secondary`}
        >
          <span aria-hidden="true" />
          <span>{localize('com_ui_name')}</span>
          <span className="text-right">{localize('com_ui_tars_mcp_permissions_tools_header')}</span>
        </div>
        {managedServers.map((server) => (
          <PermissionServerRow
            key={server.id}
            server={server}
            checkedTools={selection.get(server.id)}
            isExpanded={expanded.has(server.id)}
            onToggleExpanded={() => toggleExpanded(server.id)}
            onToggleServer={(checked) => toggleServer(server.id, checked)}
            onToggleTool={toggleTool}
          />
        ))}
        {managedServers.length === 0 && (
          <p className="py-8 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_mcp_empty')}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="submit" onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
        </Button>
      </div>
    </div>
  );
}
