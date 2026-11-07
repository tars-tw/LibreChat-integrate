import type { TPlugin } from 'librechat-data-provider';
import type { AgentItem } from './types';

/** TARS: the provider whose admin-managed key an item lacks; such an item cannot be added. */
export function getMissingKeyProvider(item: AgentItem): string | undefined {
  switch (item.kind) {
    case 'tool':
      return item.plugin.missingKeyProvider;
    case 'builtin':
      return item.missingKeyProvider;
    default:
      return undefined;
  }
}

/** A tool requires auth when it declares credential fields and isn't authenticated yet. */
export function pluginNeedsAuth(plugin: TPlugin): boolean {
  return (
    Array.isArray(plugin.authConfig) &&
    plugin.authConfig.length > 0 &&
    plugin.authenticated !== true
  );
}
