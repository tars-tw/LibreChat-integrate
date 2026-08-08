import { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Spinner, Checkbox, useToastContext } from '@librechat/client';
import type { TTarsMcpTool, TTarsMcpServer } from 'librechat-data-provider';
import {
  useTarsMcpServerQuery,
  useTarsMcpServersQuery,
  useSaveTarsDomainMcpMutation,
  useTarsDomainMcpServersQuery,
  useTarsDomainPrepareDataQuery,
} from '~/data-provider';
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
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-hover">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={localize('com_ui_tars_mcp_toggle_tools')}
          aria-expanded={isExpanded}
          className="rounded p-0.5 text-text-secondary hover:text-text-primary"
        >
          {isExpanded ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
        </button>
        <Checkbox
          aria-label={server.name}
          checked={isServerChecked}
          onCheckedChange={(checked) => onToggleServer(checked === true)}
        />
        <span className="text-sm font-medium text-text-primary">{server.name}</span>
        <span className="text-xs text-text-secondary">{selectionLabel}</span>
      </div>
      {isExpanded && (
        <ul className="space-y-1 px-10 pb-2">
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
                <li key={tool.id} className="flex items-center gap-2">
                  <Checkbox
                    aria-label={tool.name}
                    checked={isToolChecked}
                    onCheckedChange={(checked) =>
                      onToggleTool(server.id, allToolIds, tool.id, checked === true)
                    }
                  />
                  <span className="font-mono text-xs text-text-primary">{tool.name}</span>
                  {tool.description != null && tool.description !== '' && (
                    <span className="truncate text-xs text-text-secondary" title={tool.description}>
                      {tool.description}
                    </span>
                  )}
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

  const domains = prepareData?.sys_domains ?? [];
  const managedServers = useMemo(
    () => servers.filter((server) => MANAGED_TYPES.has(server.type)),
    [servers],
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

  const toggleDomain = (domainId: number) => {
    setSelectedDomainIds((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) {
        next.delete(domainId);
      } else {
        next.add(domainId);
      }
      return next;
    });
  };

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
        <h2 className="mb-2 text-sm font-medium text-text-primary">
          {localize('com_ui_tars_mcp_select_domains')}
        </h2>
        <p className="mb-3 text-xs text-text-secondary">
          {localize('com_ui_tars_mcp_permissions_hint')}
        </p>
        <div className="flex flex-wrap gap-2">
          {domains.map((domain) => (
            <button
              key={domain.id}
              type="button"
              onClick={() => toggleDomain(domain.id)}
              aria-pressed={selectedDomainIds.has(domain.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                selectedDomainIds.has(domain.id)
                  ? 'border-border-heavy bg-surface-tertiary text-text-primary'
                  : 'border-border-light text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {domain.name}
            </button>
          ))}
          {domains.length === 0 && (
            <p className="text-sm text-text-secondary">{localize('com_ui_tars_mcp_no_domains')}</p>
          )}
        </div>
        {selectedDomainIds.size > 1 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {localize('com_ui_tars_mcp_multi_domain_warning')}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-light">
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
        <Button onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
        </Button>
      </div>
    </div>
  );
}
