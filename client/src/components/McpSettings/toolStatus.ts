import type { TTarsMcpDirectToolsStatus, TTarsMcpUserServer } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** The message for a list that could not be read, which applies whatever else it shows. */
export function directToolsFailureKey(status?: TTarsMcpDirectToolsStatus): TranslationKeys | null {
  if (status === 'timeout') {
    return 'com_ui_tars_mcp_oidc_tools_timeout';
  }
  return status === 'error' ? 'com_ui_tars_mcp_oidc_tools_error' : null;
}

/** Why a server in My Tools lists no tools. */
export function emptyToolsKey(server: TTarsMcpUserServer): TranslationKeys {
  if (server.auth_type !== 'oidc') {
    return 'com_ui_tars_mcp_no_tools';
  }
  if (server.tools_status === 'none_opened') {
    return 'com_ui_tars_mcp_oidc_tools_none_opened';
  }
  return directToolsFailureKey(server.tools_status) ?? 'com_ui_tars_mcp_oidc_user_hint';
}
