import { logger } from '@librechat/data-schemas';
import { tarsPluginToolName } from 'librechat-data-provider';
import type { TPlugin } from 'librechat-data-provider';
import { primeTarsPluginManifests } from './client';
import { isTarsConfigured } from '~/tars/client';

/**
 * pwc_tars's loaded plugin tools as agent-builder tools (`tars_plugin_<name>`),
 * for `GET /api/agents/tools`. The builder is their gate — no brain decides
 * which ones an agent may carry — so every plugin pwc_tars loaded is offered,
 * and only to linked accounts, the ones that can run them. Fails soft: with
 * pwc_tars down the builder simply lists none.
 */
export async function listTarsPluginCatalog(tarsUserId?: string | null): Promise<TPlugin[]> {
  if (!tarsUserId || !isTarsConfigured()) {
    return [];
  }
  try {
    const manifests = await primeTarsPluginManifests();
    return [...manifests.values()].map((manifest) => ({
      name: manifest.display_name,
      pluginKey: tarsPluginToolName(manifest.name),
      description: manifest.description,
      authConfig: [],
    }));
  } catch (error) {
    logger.warn('[tars-plugins] Failed to list plugin tools for the agent builder', error);
    return [];
  }
}
