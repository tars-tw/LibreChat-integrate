import type { TTarsMcpServer } from 'librechat-data-provider';

/** The server types managed from these tabs; pwc_tars's `builtin` servers are not proxied. */
export const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);

/** Managed servers whose name, code or description contains the query, ignoring case. */
export const filterManagedServers = (
  servers: TTarsMcpServer[],
  query: string,
): TTarsMcpServer[] => {
  const needle = query.trim().toLowerCase();
  return servers.filter(
    (server) =>
      MANAGED_TYPES.has(server.type) &&
      (!needle ||
        [server.name, server.code, server.description].some(
          (field) => field?.toLowerCase().includes(needle) === true,
        )),
  );
};
