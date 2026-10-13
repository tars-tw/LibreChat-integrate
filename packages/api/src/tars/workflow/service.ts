import jwt from 'jsonwebtoken';
import type { WorkflowFlow } from '~/langflow/sync';

/** Bounds one server-to-server call; Langflow refuses service tokens living over 2 minutes. */
const SERVICE_TOKEN_TTL_SECONDS = 60;
const SERVICE_TIMEOUT_MS = 5000;

/** A pwc_tars user who has entered Workflow, so an admin can switch into their workspace. */
export interface WorkflowAccount {
  tarsId: string;
  username: string;
  lastLoginAt: string | null;
}

interface LangflowAccountRow {
  tars_id: string;
  username: string;
  last_login_at: string | null;
}

/** Langflow answered a service call with a non-2xx status (or not at all). */
export class WorkflowServiceError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'WorkflowServiceError';
    this.status = status;
  }
}

/**
 * The Langflow origin this backend reaches, from the same variable the reconcile service uses
 * (`VITE_LANGFLOW_URL`, inside Docker the internal `http://langflow:7860`). Null when unset.
 */
export function resolveLangflowOrigin(
  value: string | undefined = process.env.VITE_LANGFLOW_URL || process.env.LANGFLOW_BASE_URL,
): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The bearer for Langflow's `/api/v1/tars` service routes: HS256 over the shared secret,
 * audience `langflow-service` so it can never pass as a sign-in ticket.
 */
export function signWorkflowServiceToken(secret: string): string {
  return jwt.sign({}, secret, {
    algorithm: 'HS256',
    issuer: 'librechat',
    audience: 'langflow-service',
    expiresIn: SERVICE_TOKEN_TTL_SECONDS,
  });
}

/** `GET {langflow}/api/v1/tars/accounts`: every active Langflow account linked to a pwc_tars user. */
export async function fetchWorkflowAccounts(
  origin: string,
  secret: string,
): Promise<WorkflowAccount[]> {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/tars/accounts`, {
      headers: { Authorization: `Bearer ${signWorkflowServiceToken(secret)}` },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WorkflowServiceError(`Langflow is unreachable: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new WorkflowServiceError(`Langflow refused the accounts call`, response.status);
  }
  const rows = (await response.json()) as LangflowAccountRow[];
  return rows.map((row) => ({
    tarsId: row.tars_id,
    username: row.username,
    lastLoginAt: row.last_login_at,
  }));
}

interface LangflowFlowRow {
  tool_name: string;
  flow_id: string;
  name: string;
  description: string;
  owner: 'system' | 'personal';
  tars_model: string | null;
  action_name: string;
}

/**
 * `GET {langflow}/api/v1/tars/flows`: the tools Langflow publishes to `tarsId` — the shared
 * account's MCP-enabled flows plus that user's own. Authenticated the way LibreChat's Langflow MCP
 * connection is: the system account's API key, with the chatting user in the request-variable
 * header. Throws when Langflow is unreachable or refuses the key.
 */
export async function fetchWorkflowFlows(
  origin: string,
  apiKey: string,
  tarsId?: string,
): Promise<WorkflowFlow[]> {
  const headers: Record<string, string> = { 'x-api-key': apiKey };
  if (tarsId) {
    headers['x-langflow-global-var-tars_user_id'] = tarsId;
  }
  let response: Response;
  try {
    response = await fetch(`${origin}/api/v1/tars/flows`, {
      headers,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WorkflowServiceError(`Langflow is unreachable: ${(error as Error).message}`);
  }
  if (response.status === 403) {
    throw new WorkflowServiceError(
      "Langflow refused LANGFLOW_API_KEY: it must be the system account's (LANGFLOW_SUPERUSER) key",
      403,
    );
  }
  if (!response.ok) {
    throw new WorkflowServiceError('Langflow refused the flows call', response.status);
  }
  const rows = (await response.json()) as LangflowFlowRow[];
  return rows.map((row) => ({
    toolName: row.tool_name,
    flowId: row.flow_id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    tarsModel: row.tars_model,
    actionName: row.action_name,
  }));
}

/** What Langflow did with a departed user's flows (`POST /api/v1/tars/accounts/:id/transfer`). */
export interface WorkflowTransferResult {
  moved: number;
  project: string | null;
  deactivated: boolean;
}

/**
 * Asks Langflow to hand every flow `tarsId` owns to the system account (unpublished, in a new
 * project named after `label`); `deactivate` also closes their Langflow account.
 */
export async function requestWorkflowTransfer(
  origin: string,
  secret: string,
  tarsId: string,
  request: { label: string; deactivate: boolean },
): Promise<WorkflowTransferResult> {
  let response: Response;
  try {
    response = await fetch(
      `${origin}/api/v1/tars/accounts/${encodeURIComponent(tarsId)}/transfer`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signWorkflowServiceToken(secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new WorkflowServiceError(`Langflow is unreachable: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new WorkflowServiceError('Langflow refused the transfer', response.status);
  }
  return (await response.json()) as WorkflowTransferResult;
}
