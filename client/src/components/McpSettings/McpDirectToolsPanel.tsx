import { Spinner, useToastContext } from '@librechat/client';
import { useTarsMcpDirectToolsQuery, useUpdateTarsMcpDirectToolsMutation } from '~/data-provider';
import { directToolsFailureKey } from './toolStatus';
import McpToolRow from './McpToolRow';
import { useLocalize } from '~/hooks';

/** An OIDC server's tools in the admin table: only the ones opened here reach any user. */
export default function McpDirectToolsPanel({ serverId }: { serverId: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError } = useTarsMcpDirectToolsQuery(serverId);
  const tools = data?.tools ?? [];
  const notice = directToolsFailureKey(isError ? 'error' : data?.tools_status);
  const update = useUpdateTarsMcpDirectToolsMutation(serverId, {
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="icon-sm" />
      </div>
    );
  }

  const toggle = (name: string, enabled: boolean) => {
    const others = tools.filter((tool) => tool.is_enabled && tool.name !== name);
    update.mutate([...others.map((tool) => tool.name), ...(enabled ? [name] : [])]);
  };

  return (
    <div>
      <p className="text-text-secondary mb-2 px-2 text-xs">
        {localize('com_ui_tars_mcp_oidc_admin_tools_hint')}
      </p>
      {notice != null && (
        <p role="status" className="text-text-primary mb-2 px-2 text-xs">
          {localize(notice)}
        </p>
      )}
      {tools.length > 0 && (
        <ul className="divide-border-light divide-y">
          {tools.map((tool) => (
            <McpToolRow
              key={tool.name}
              name={tool.name}
              description={tool.description}
              enabled={tool.is_enabled}
              disabled={update.isLoading}
              onChange={(checked) => toggle(tool.name, checked)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
