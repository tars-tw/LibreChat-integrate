import { useState } from 'react';
import { Label, Input, Button, Spinner, useToastContext } from '@librechat/client';
import type { TTarsMcpUserServer } from 'librechat-data-provider';
import {
  useSaveTarsMcpUserCredentialsMutation,
  useClearTarsMcpUserCredentialsMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface McpCredentialsFormProps {
  server: TTarsMcpUserServer;
  /** Called after pwc_tars verified and stored the credentials. */
  onSaved?: () => void;
}

const isSecretField = (name: string) => name === 'value' || /password|secret|token/i.test(name);

function credentialFieldNames(server: TTarsMcpUserServer): string[] {
  if (server.auth_type === 'bearer' || server.auth_type === 'api_key') {
    return ['value'];
  }
  if (server.auth_type === 'basic') {
    return ['username', 'password'];
  }
  return server.login_fields.length > 0 ? server.login_fields : ['username', 'password'];
}

/**
 * Per-user credentials for one pwc_tars MCP server. pwc_tars verifies against
 * the live API before persisting, so a save that resolves means the server is
 * usable — shared by the TARS tools panel and the chat server menu.
 */
export default function McpCredentialsForm({ server, onSaved }: McpCredentialsFormProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fieldNames = credentialFieldNames(server);
  const [values, setValues] = useState<Record<string, string>>({});

  const saveMutation = useSaveTarsMcpUserCredentialsMutation({
    onSuccess: () => {
      setValues({});
      showToast({ message: localize('com_ui_tars_mcp_creds_saved'), status: 'success' });
      onSaved?.();
    },
    onError: (error) =>
      showToast({
        message: (error as Error)?.message || localize('com_ui_tars_mcp_creds_failed'),
        status: 'error',
      }),
  });
  const clearMutation = useClearTarsMcpUserCredentialsMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_mcp_creds_cleared'), status: 'success' }),
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  const handleSave = () => {
    const missing = fieldNames.some((name) => !values[name]?.trim());
    if (missing) {
      showToast({ message: localize('com_ui_tars_mcp_creds_required'), status: 'error' });
      return;
    }
    saveMutation.mutate({ id: server.id, credentials: values });
  };

  return (
    <div className="space-y-2 rounded-lg bg-surface-secondary p-3">
      <div className="grid grid-cols-2 gap-2">
        {fieldNames.map((name) => (
          <div key={name} className={fieldNames.length === 1 ? 'col-span-2' : ''}>
            <Label className="text-xs">
              {name === 'value' ? localize('com_ui_tars_mcp_creds_token') : name}
            </Label>
            <Input
              type={isSecretField(name) ? 'password' : 'text'}
              value={values[name] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {server.has_credentials && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => clearMutation.mutate(server.id)}
            disabled={clearMutation.isLoading}
          >
            {clearMutation.isLoading ? <Spinner /> : localize('com_ui_tars_mcp_creds_clear')}
          </Button>
        )}
        <Button size="sm" onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading
            ? localize('com_ui_tars_mcp_creds_verifying')
            : localize('com_ui_tars_mcp_creds_save')}
        </Button>
      </div>
    </div>
  );
}
