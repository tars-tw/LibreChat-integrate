import type { TPlugin } from 'librechat-data-provider';
import type { AgentItem } from './types';

/** TARS: the provider whose 模型金鑰管理 key a tool lacks; such a tool cannot be added. */
export function getMissingKeyProvider(item: AgentItem): string | undefined {
  return item.kind === 'tool' ? item.plugin.missingKeyProvider : undefined;
}

/** A tool requires auth when it declares credential fields and isn't authenticated yet. */
export function pluginNeedsAuth(plugin: TPlugin): boolean {
  return (
    Array.isArray(plugin.authConfig) &&
    plugin.authConfig.length > 0 &&
    plugin.authenticated !== true
  );
}
