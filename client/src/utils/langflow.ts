/**
 * The public Langflow address, fixed into the bundle at build time. A relative value resolves
 * against this page, and the trailing slash keeps any path prefix when joining endpoints.
 */
const LANGFLOW_BASE = new URL(
  (import.meta.env.VITE_LANGFLOW_URL || 'http://localhost:7860').replace(/\/*$/, '/'),
  window.location.origin,
);

const langflowEndpoint = (path: string): URL => new URL(path, LANGFLOW_BASE);

/** Langflow's sign-in address for a one-time Workflow ticket; it redirects into the app. */
export function langflowSignInUrl(ticket: string): string {
  const url = langflowEndpoint('api/v1/tars/sso');
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

/**
 * Ends the Langflow session alongside LibreChat's, so the next person at this browser cannot
 * open the Langflow address directly as the previous user. Langflow is same-site with this
 * page, so its cookies ride along and the TARS logout clears them — the session and the
 * operator identity the canvas runs TARS components as. `no-cors` because the opaque reply
 * is never read. Best effort: a Langflow that is down has no session to end, and LibreChat's
 * own logout must not wait on it.
 */
export function signOutOfLangflow(): void {
  fetch(langflowEndpoint('api/v1/tars/logout'), {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'include',
    keepalive: true,
  }).catch(() => undefined);
}
