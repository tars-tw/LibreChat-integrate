import type { TTarsMcpServer, TTarsMcpUserServer } from 'librechat-data-provider';

/**
 * An OIDC server the app connects to itself (external). TARS lists none of its tools: they come
 * from each user's sign-in and are opened here. An OIDC OpenAPI or custom API server is not one:
 * TARS still lists and runs its tools, on the token the app hands it per call.
 */
export function isDirectOidcServer(server?: TTarsMcpServer | null): boolean {
  const auth = server?.connection_config?.auth as { type?: string } | undefined;
  return server?.type === 'external' && auth?.type === 'oidc';
}

export function isDirectOidcUserServer(
  server: Pick<TTarsMcpUserServer, 'type' | 'auth_type'>,
): boolean {
  return server.type === 'external' && server.auth_type === 'oidc';
}
