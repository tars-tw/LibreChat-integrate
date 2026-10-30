import {
  TARS_MCP_SHARE_BLOCKED,
  TARS_MCP_PUBLIC_SHARE_BLOCKED,
  TARS_MCP_SHARE_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import type { TTarsMcpShareBlock } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

const PERMISSION_ERROR_KEYS: Record<string, TranslationKeys> = {
  RESOURCE_PERMISSIONS_BUSY: 'com_ui_permissions_busy',
  RESOURCE_PERMISSIONS_UNAVAILABLE: 'com_ui_permissions_unavailable',
  PERMISSION_AUDIT_UNAVAILABLE: 'com_ui_permissions_audit_unavailable',
  [TARS_MCP_SHARE_BLOCKED]: 'com_ui_tars_mcp_share_blocked',
  [TARS_MCP_PUBLIC_SHARE_BLOCKED]: 'com_ui_tars_mcp_share_public_blocked',
  [TARS_MCP_SHARE_CHECK_UNAVAILABLE]: 'com_ui_tars_mcp_share_check_unavailable',
};

type ErrorData = { code?: string; blocked?: TTarsMcpShareBlock[] };

const errorData = (error: unknown): ErrorData | undefined =>
  (error as { response?: { data?: ErrorData } } | null)?.response?.data;

/** The localized message for a failed permission update, from the stable code the API returns. */
export function permissionErrorKey(error: unknown): TranslationKeys {
  const code = errorData(error)?.code;
  return (code && PERMISSION_ERROR_KEYS[code]) || 'com_ui_permissions_failed_update';
}

/** Who a share was refused for, when it was refused over their MCP assignments. */
export function mcpShareBlocks(error: unknown): TTarsMcpShareBlock[] {
  return errorData(error)?.blocked ?? [];
}

/**
 * Why saving an agent was refused for the people it is already shared with, or `null` when
 * the failure was something else. Those people are not on screen as they are in the share
 * dialog, so the toast has to name them.
 */
export function agentSaveShareError(
  error: unknown,
  localize: (key: TranslationKeys, values?: Record<string, string>) => string,
): string | null {
  const data = errorData(error);
  switch (data?.code) {
    case TARS_MCP_SHARE_BLOCKED:
      return localize('com_ui_tars_mcp_save_blocked', {
        names: (data.blocked ?? []).map((block) => block.name).join(', '),
      });
    case TARS_MCP_PUBLIC_SHARE_BLOCKED:
      return localize('com_ui_tars_mcp_save_public_blocked');
    case TARS_MCP_SHARE_CHECK_UNAVAILABLE:
      return localize('com_ui_tars_mcp_share_check_unavailable');
    default:
      return null;
  }
}
