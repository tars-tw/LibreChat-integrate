import type { TPlugin } from 'librechat-data-provider';
import { getTarsSysConfigValue } from './sysconfig';
import { isTarsConfigured } from './client';

/** A manifest tool whose credential an admin keeps in 模型金鑰管理 (pwc_tars sys_config). */
interface TarsKeyedTool {
  /** The sys_config row holding the key. */
  sysConfigKey: string;
  /** The manifest auth field the tool's constructor reads the key from. */
  authField: string;
  /** The provider named to the user while the key is missing. */
  provider: string;
}

/**
 * Manifest tools whose key comes only from 模型金鑰管理 while pwc_tars is configured: never env,
 * never a key a user saved for themselves.
 */
const TARS_KEYED_TOOLS = new Map<string, TarsKeyedTool>([
  [
    'image_gen_oai',
    { sysConfigKey: 'KEY_OPEN_AI_API', authField: 'IMAGE_GEN_OAI_API_KEY', provider: 'OpenAI' },
  ],
]);

function getTarsKeyedTool(pluginKey: string): TarsKeyedTool | undefined {
  return isTarsConfigured() ? TARS_KEYED_TOOLS.get(pluginKey) : undefined;
}

async function applyTarsToolKey<T extends TPlugin>(tool: T): Promise<T> {
  const keyed = getTarsKeyedTool(tool.pluginKey);
  if (!keyed) {
    return tool;
  }
  if (await getTarsSysConfigValue(keyed.sysConfigKey)) {
    return { ...tool, authConfig: undefined, authenticated: true };
  }
  return {
    ...tool,
    authConfig: undefined,
    authenticated: undefined,
    missingKeyProvider: keyed.provider,
  };
}

/**
 * The tool listing with each keyed tool's credential form removed, so no user is asked for the
 * key: marked `authenticated` when 模型金鑰管理 holds it, otherwise carrying `missingKeyProvider`.
 */
export async function withTarsToolKeys<T extends TPlugin>(tools: T[]): Promise<T[]> {
  if (!isTarsConfigured()) {
    return tools;
  }
  return Promise.all(tools.map(applyTarsToolKey));
}

/**
 * A keyed tool's auth values from 模型金鑰管理, or undefined for any other tool (and while pwc_tars
 * is unconfigured), which then loads its credentials as usual. Throws when the key is unset.
 */
export async function loadTarsToolAuthValues(
  pluginKey: string,
): Promise<Record<string, string> | undefined> {
  const keyed = getTarsKeyedTool(pluginKey);
  if (!keyed) {
    return undefined;
  }
  const value = await getTarsSysConfigValue(keyed.sysConfigKey);
  if (!value) {
    throw new Error(
      `${keyed.provider} API key is not set in 模型金鑰管理 (pwc_tars sys_config "${keyed.sysConfigKey}")`,
    );
  }
  return { [keyed.authField]: value };
}
