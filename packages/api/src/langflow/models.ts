import { logger } from '@librechat/data-schemas';

/** Node types whose configuration names the model a flow does its pwc_tars work on. */
const TARS_NODE_TYPES = new Set(['TarsTool', 'TarsAgent']);

/**
 * Template fields that can hold a TARS node's model, most specific first. `TarsTool` builds
 * `ctx__model_name` from the tool manifest and falls back to its own advanced `model_name`;
 * `TarsAgent` only has the latter. Mirrors the precedence the components apply at run time.
 */
const MODEL_FIELDS = ['ctx__model_name', 'model_name'];

const FETCH_TIMEOUT_MS = 3000;

interface LangflowTemplateField {
  value?: string | number | boolean | null;
}

interface LangflowFlowNode {
  data?: {
    type?: string;
    node?: { template?: Record<string, LangflowTemplateField> };
  };
}

export interface LangflowFlowDefinition {
  data?: { nodes?: LangflowFlowNode[] };
}

export interface FlowAgentModelsParams {
  origin: string;
  apiKey: string;
  flowIds: string[];
  timeoutMs?: number;
}

function templateModel(template?: Record<string, LangflowTemplateField>): string | undefined {
  if (template == null) {
    return undefined;
  }
  for (const field of MODEL_FIELDS) {
    const value = template[field]?.value;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * The model named by the flow's first configured TARS node, or undefined when no node names one —
 * an empty field means "let pwc_tars pick its system default", which is not a model this side can
 * resolve to an endpoint.
 */
export function findFlowAgentModel(flow: LangflowFlowDefinition | null): string | undefined {
  for (const node of flow?.data?.nodes ?? []) {
    const type = node?.data?.type;
    if (type == null || !TARS_NODE_TYPES.has(type)) {
      continue;
    }
    const model = templateModel(node.data?.node?.template);
    if (model != null) {
      return model;
    }
  }
  return undefined;
}

async function fetchFlow(
  origin: string,
  apiKey: string,
  flowId: string,
  timeoutMs: number,
): Promise<LangflowFlowDefinition | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/v1/flows/${encodeURIComponent(flowId)}`, {
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as LangflowFlowDefinition;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Models the given flows' TARS nodes name, keyed by flow id. Flows without a TARS node, without a
 * model on it, or that fail to load are simply absent, so a caller reads the map as "these flows
 * pin a model" and leaves the rest on its own default. Fetched per flow rather than through the
 * bulk listing: one flow is ~45KB where `?get_all=true` is ~1MB of mostly component source.
 */
export async function fetchFlowAgentModels({
  origin,
  apiKey,
  flowIds,
  timeoutMs = FETCH_TIMEOUT_MS,
}: FlowAgentModelsParams): Promise<Map<string, string>> {
  const models = new Map<string, string>();
  if (flowIds.length === 0) {
    return models;
  }
  const flows = await Promise.all(
    flowIds.map((flowId) => fetchFlow(origin, apiKey, flowId, timeoutMs)),
  );
  for (let i = 0; i < flows.length; i++) {
    const model = findFlowAgentModel(flows[i]);
    if (model != null) {
      models.set(flowIds[i], model);
    }
  }
  return models;
}

/**
 * The endpoint whose catalogue serves `model`, or undefined when this LibreChat serves no such
 * model. Endpoints are searched in the order the models config lists them, so the answer is stable
 * for a model several endpoints happen to offer.
 */
export function findModelEndpoint(
  model: string,
  modelsConfig: Record<string, string[] | undefined>,
): string | undefined {
  const wanted = model.trim().toLowerCase();
  if (wanted.length === 0) {
    return undefined;
  }
  for (const [endpoint, models] of Object.entries(modelsConfig)) {
    if (models?.some((candidate) => candidate.toLowerCase() === wanted) === true) {
      return endpoint;
    }
  }
  logger.debug(`[langflow/models] No configured endpoint serves model "${model}".`);
  return undefined;
}
