import { logger } from '@librechat/data-schemas';
import type {
  TTarsPrincipalInfo,
  TTarsKnowledgeBaseShareGap,
  TTarsKnowledgeBaseChatSaveResult,
  TTarsKnowledgeBaseChatSavePayload,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TarsPrompt, TarsPromptKnowledgeBase } from './prompts';
import type { TarsAccessEnvelope } from './client';
import type { TarsAccessUser } from '~/auth/tars';
import { invalidateTarsScopedKnowledgeBasesCache, fetchTarsChatKnowledgeBases } from './scope';
import { fetchTarsPersonalPrompts, fetchTarsKnowledgeBasePrompts } from './prompts';
import { canUseTarsAdminPage, isTarsAdminRole } from '~/auth/tars';
import { fetchTarsManagedKnowledgeBases } from './managed';
import { tarsFetch } from './client';

/** The admin-menu key of 知識庫清單; a place on any management list opens it. */
export const TARS_KNOWLEDGE_MENU_KEY = 'kb.list';

/**
 * One knowledge base's chat list, disabled principals included. pwc_tars lets only an
 * admin or one of the knowledge base's managers read or write it, so both calls go
 * out as the acting user (`asUser`).
 */
export async function fetchTarsKnowledgeBaseChatAssignees(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TTarsPrincipalInfo[]> {
  const envelope = await tarsFetch<TarsAccessEnvelope<{ principals?: TTarsPrincipalInfo[] }>>(
    '/api/km_permission/assignments',
    { query: { knowledge_base_id: knowledgeBaseId }, asUser: tarsId, baseUrl },
  );
  return envelope?.data?.principals ?? [];
}

/**
 * Overwrites one knowledge base's chat list; pwc_tars validates the principals. Every
 * user's chat scope may change, so the cached scopes are dropped.
 */
export async function saveTarsKnowledgeBaseChatAssignees(
  tarsId: string,
  knowledgeBaseId: string,
  payload: TTarsKnowledgeBaseChatSavePayload,
  baseUrl?: string,
): Promise<TTarsKnowledgeBaseChatSaveResult | undefined> {
  const envelope = await tarsFetch<TarsAccessEnvelope<TTarsKnowledgeBaseChatSaveResult>>(
    '/api/km_permission/assignments/save',
    {
      method: 'POST',
      body: { knowledge_base_id: knowledgeBaseId, principals: payload?.principals },
      asUser: tarsId,
      baseUrl,
    },
  );
  invalidateTarsScopedKnowledgeBasesCache();
  return envelope?.data;
}

/** A user or group as pwc_tars identifies it in a share check. */
export interface TarsKnowledgeSharePrincipal {
  principal_type: 'user' | 'group';
  principal_id: string;
}

export interface TarsKnowledgeShareCheck {
  knowledge_bases: TTarsKnowledgeBaseShareGap[];
  missing: Array<TarsKnowledgeSharePrincipal & { knowledge_bases: TTarsKnowledgeBaseShareGap[] }>;
}

/**
 * Which share targets may not use the given knowledge bases in chat
 * (`POST /api/km_permission/share_check`): users on their own grants plus their enabled
 * groups', groups on their own assignment only, administrators included. A disabled or
 * deleted knowledge base is missing for everyone. Not admin-only: the sharer rarely is one.
 */
export async function fetchTarsKnowledgeBaseShareCheck(
  knowledgeBaseIds: string[],
  principals: TarsKnowledgeSharePrincipal[],
  baseUrl?: string,
): Promise<TarsKnowledgeShareCheck> {
  const envelope = await tarsFetch<TarsAccessEnvelope<TarsKnowledgeShareCheck>>(
    '/api/km_permission/share_check',
    { method: 'POST', body: { knowledge_base_ids: knowledgeBaseIds, principals }, baseUrl },
  );
  return {
    knowledge_bases: envelope?.data?.knowledge_bases ?? [],
    missing: envelope?.data?.missing ?? [],
  };
}

/** The chat's 我的提示 list and the knowledge bases it may create prompts for. */
export interface TarsChatPrompts {
  prompts: TarsPrompt[];
  knowledgeBases: TarsPromptKnowledgeBase[];
}

/**
 * The prompts a chat offers (composer panel, `/` commands, side panel): the user's own,
 * plus those of the knowledge bases the agent's 知識庫檢索 picked that the user may use in
 * chat. No 專用腦 tier: an agent binds no brain. Ids the user may not reach are dropped,
 * so a client cannot list the prompts of a knowledge base it was never granted.
 */
export async function fetchTarsChatPrompts(
  tarsId: string,
  knowledgeBaseIds: readonly string[],
  baseUrl?: string,
): Promise<TarsChatPrompts> {
  const wanted = new Set(knowledgeBaseIds);
  const [personal, reachable] = await Promise.all([
    fetchTarsPersonalPrompts(tarsId, baseUrl),
    wanted.size > 0 ? fetchTarsChatKnowledgeBases(tarsId, baseUrl) : Promise.resolve([]),
  ]);
  const knowledgeBases = reachable
    .filter((kb) => wanted.has(kb.id))
    .map(({ id, name }) => ({ id, name }));
  const shared = await Promise.all(
    knowledgeBases.map(async (kb) =>
      (await fetchTarsKnowledgeBasePrompts(kb.id, baseUrl)).map(
        (prompt): TarsPrompt => ({
          ...prompt,
          scope: 'knowledge_base',
          knowledge_base_name: prompt.knowledge_base_name || kb.name,
        }),
      ),
    ),
  );
  return {
    prompts: [
      ...shared.flat(),
      ...personal.map((prompt): TarsPrompt => ({ ...prompt, scope: 'personal' })),
    ],
    knowledgeBases,
  };
}

// ---------------------------------------------------------------------------
// 知識庫清單 entry: a place on any management list opens it
// ---------------------------------------------------------------------------

/** Whether a user manages at least one knowledge base, which opens 知識庫清單 for them. */
async function managesAnyKnowledgeBase(tarsId: string): Promise<boolean> {
  const managed = await fetchTarsManagedKnowledgeBases(tarsId);
  return managed.all || managed.ids.size > 0;
}

/**
 * The admin-menu keys to hand the client: the role grants resolved at login, plus
 * 知識庫清單 for anyone on a knowledge base's management list. Read per request, so a
 * new place on a list shows after a page reload rather than a new login. Fails soft:
 * without pwc_tars the role grants stand alone.
 */
export async function resolveTarsAdminMenuKeys(
  user: TarsAccessUser | null | undefined,
): Promise<string[] | undefined> {
  const granted = user?.tarsAdminMenuKeys ?? undefined;
  if (!user?.tarsId || isTarsAdminRole(user.tarsRoleId ?? null)) {
    return granted;
  }
  if (granted?.includes(TARS_KNOWLEDGE_MENU_KEY)) {
    return granted;
  }
  try {
    return (await managesAnyKnowledgeBase(user.tarsId))
      ? [...(granted ?? []), TARS_KNOWLEDGE_MENU_KEY]
      : granted;
  } catch (error) {
    logger.warn('[tars-access] Could not read the knowledge bases a user manages', error);
    return granted;
  }
}

/**
 * Wraps a user loader so the user it returns carries {@link resolveTarsAdminMenuKeys}.
 * Used where an auth response hands the client its user (the token refresh), which the
 * client reads before `GET /api/user` answers.
 */
export function withTarsAdminMenuKeys<Args extends unknown[], U extends TarsAccessUser>(
  load: (...args: Args) => Promise<U | null>,
): (...args: Args) => Promise<U | null> {
  return async (...args) => {
    const user = await load(...args);
    if (!user?.tarsId) {
      return user;
    }
    const keys = await resolveTarsAdminMenuKeys(user);
    return keys === user.tarsAdminMenuKeys ? user : { ...user, tarsAdminMenuKeys: keys };
  };
}

/**
 * Whether a user may use an admin page whose menu key is one of `keys`:
 * {@link canUseTarsAdminPage}, or 知識庫清單 through a place on a management list.
 * Fails closed when pwc_tars cannot say.
 */
export async function canUseTarsAdminPageNow(
  user: TarsAccessUser | null | undefined,
  keys: string[],
): Promise<boolean> {
  if (canUseTarsAdminPage(user, keys)) {
    return true;
  }
  if (!user?.tarsId || !keys.includes(TARS_KNOWLEDGE_MENU_KEY)) {
    return false;
  }
  try {
    return await managesAnyKnowledgeBase(user.tarsId);
  } catch (error) {
    logger.warn('[tars-access] Could not read the knowledge bases a user manages', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-knowledge-base checks for the 知識庫清單 API
// ---------------------------------------------------------------------------

/** The kinds of dataset pwc_tars can name the owning knowledge base(s) of. */
export const TARS_RESOURCE_TYPES = [
  'document_ids',
  'chunk_ids',
  'website_ids',
  'sql_binding_ids',
  'file_system_association_ids',
  'schedule_ids',
] as const;

export type TarsResourceType = (typeof TARS_RESOURCE_TYPES)[number];

export type TarsResourceQuery = Partial<Record<TarsResourceType, unknown>>;

/** `{type: {resource id: [knowledge base id]}}`; an unknown resource is absent. */
export type TarsResourceOwners = Record<TarsResourceType, Record<string, string[]>>;

/** Which knowledge base(s) each dataset belongs to (pwc_tars `km_permission/resource_owners`). */
export async function fetchTarsResourceOwners(
  query: Partial<Record<TarsResourceType, string[]>>,
  baseUrl?: string,
): Promise<TarsResourceOwners> {
  const envelope = await tarsFetch<TarsAccessEnvelope<Partial<TarsResourceOwners>>>(
    '/api/km_permission/resource_owners',
    { method: 'POST', body: query, baseUrl },
  );
  const data = envelope?.data ?? {};
  return Object.fromEntries(
    TARS_RESOURCE_TYPES.map((type) => [type, data[type] ?? {}]),
  ) as TarsResourceOwners;
}

/**
 * What a request touches: the knowledge base in its path, and any datasets it names
 * (an id or a list of ids, as the request carries them). A dataset must belong to that
 * knowledge base, or, with none in the path, to one the user manages.
 */
export interface TarsKnowledgeTarget {
  knowledgeBaseId?: string | null;
  resources?: TarsResourceQuery;
}

export type TarsKnowledgeVerdict = 'allowed' | 'forbidden' | 'not_found';

const toIds = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value.flat() : [value];
  return values.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
};

/** Keeps only the resource types that name at least one id. */
const namedResources = (
  resources: TarsResourceQuery | undefined,
): Partial<Record<TarsResourceType, string[]>> => {
  const named: Partial<Record<TarsResourceType, string[]>> = {};
  for (const type of TARS_RESOURCE_TYPES) {
    const ids = toIds(resources?.[type]);
    if (ids.length > 0) {
      named[type] = ids;
    }
  }
  return named;
};

/**
 * Whether a user may act on a knowledge base and the datasets a request names. A pwc_tars
 * admin may act on everything; anyone else only on knowledge bases on whose management
 * list they (or an enabled group of theirs) appear. Throws when pwc_tars cannot answer.
 */
export async function checkTarsKnowledgeAccess(
  user: TarsAccessUser | null | undefined,
  target: TarsKnowledgeTarget,
): Promise<TarsKnowledgeVerdict> {
  if (!user?.tarsId) {
    return 'forbidden';
  }
  if (isTarsAdminRole(user.tarsRoleId ?? null)) {
    return 'allowed';
  }
  const managed = await fetchTarsManagedKnowledgeBases(user.tarsId);
  if (managed.all) {
    return 'allowed';
  }
  const knowledgeBaseId = target.knowledgeBaseId ?? undefined;
  if (knowledgeBaseId != null && !managed.ids.has(knowledgeBaseId)) {
    return 'forbidden';
  }
  const resources = namedResources(target.resources);
  const types = Object.keys(resources) as TarsResourceType[];
  if (types.length === 0) {
    return knowledgeBaseId != null ? 'allowed' : 'forbidden';
  }
  const owners = await fetchTarsResourceOwners(resources);
  const inScope = (kbId: string) =>
    knowledgeBaseId != null ? kbId === knowledgeBaseId : managed.ids.has(kbId);
  let verdict: TarsKnowledgeVerdict = 'allowed';
  for (const type of types) {
    for (const id of resources[type] ?? []) {
      const kbIds = owners[type][id];
      if (kbIds == null) {
        verdict = 'not_found';
      } else if (!kbIds.some(inScope)) {
        return 'forbidden';
      }
    }
  }
  return verdict;
}

type TarsRequest = Request & { user?: TarsAccessUser };

/** An Express handler that answers or calls `next`, typed for the declaration build. */
export type TarsAccessHandler = (
  req: TarsRequest,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

const KNOWLEDGE_ACCESS_MESSAGES: Record<Exclude<TarsKnowledgeVerdict, 'allowed'>, string> = {
  forbidden: 'You do not manage this knowledge base',
  not_found: 'Knowledge base resource not found',
};

async function answerKnowledgeAccess(
  req: TarsRequest,
  res: Response,
  next: NextFunction,
  target: TarsKnowledgeTarget,
): Promise<void> {
  let verdict: TarsKnowledgeVerdict;
  try {
    verdict = await checkTarsKnowledgeAccess(req.user, target);
  } catch (error) {
    logger.error('[tars-access] Knowledge base access check failed', error);
    res.status(503).json({ error: 'Knowledge base access check is unavailable' });
    return;
  }
  if (verdict === 'allowed') {
    next();
    return;
  }
  res
    .status(verdict === 'not_found' ? 404 : 403)
    .json({ error: KNOWLEDGE_ACCESS_MESSAGES[verdict] });
}

/** Route middleware: the request proceeds only if {@link checkTarsKnowledgeAccess} allows it. */
export function requireTarsKnowledgeAccess(
  pick: (req: TarsRequest) => TarsKnowledgeTarget,
): TarsAccessHandler {
  return (req, res, next) => answerKnowledgeAccess(req, res, next, pick(req));
}

type RequestFields = Record<string, unknown>;

const fieldsOf = (value: unknown): RequestFields =>
  value != null && typeof value === 'object' ? (value as RequestFields) : {};

/**
 * The knowledge base and datasets a 知識庫清單 request names, read from the names those
 * routes use: `:id` is the knowledge base, `:docId` / `:chunkId` / `:websiteId` a dataset,
 * and the body or query may list more (`documentIds`, `websiteIds`, `bindingId`,
 * `associationId`, `existingAssociationId`, `fileSystemAssociationIds`).
 */
export function tarsKnowledgeTargetOf(req: TarsRequest): TarsKnowledgeTarget {
  const params = fieldsOf(req.params);
  const body = fieldsOf(req.body);
  const query = fieldsOf(req.query);
  return {
    knowledgeBaseId: typeof params.id === 'string' ? params.id : undefined,
    resources: {
      document_ids: [params.docId, body.documentIds],
      chunk_ids: params.chunkId,
      website_ids: [params.websiteId, body.websiteIds],
      sql_binding_ids: body.bindingId,
      file_system_association_ids: [
        body.associationId,
        body.existingAssociationId,
        query.associationId,
        body.fileSystemAssociationIds,
      ],
    },
  };
}

/** Guards a 知識庫清單 route by {@link tarsKnowledgeTargetOf}. */
export const requireTarsKnowledgeBase: TarsAccessHandler =
  requireTarsKnowledgeAccess(tarsKnowledgeTargetOf);

/**
 * What a schedule request names: the schedule in `:id`, or, when creating or listing one
 * knowledge base's schedules, that knowledge base and the dataset the schedule refreshes.
 * `null` when it names nothing (the schedule page's full list, which pwc_tars already
 * narrows to the user's knowledge bases).
 */
export function tarsScheduleTargetOf(req: TarsRequest): TarsKnowledgeTarget | null {
  const params = fieldsOf(req.params);
  if (typeof params.id === 'string') {
    return { resources: { schedule_ids: params.id } };
  }
  const body = fieldsOf(req.body);
  const query = fieldsOf(req.query);
  const knowledgeBaseId = [body.knowledgeBaseId, query.knowledgeBaseId].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  if (knowledgeBaseId == null) {
    return null;
  }
  return {
    knowledgeBaseId,
    resources: {
      file_system_association_ids: body.associationId,
      website_ids: body.datasetType === 'website' ? body.datasetId : undefined,
    },
  };
}

/** Guards a schedule route by {@link tarsScheduleTargetOf}; a request naming nothing passes. */
export function requireTarsScheduleAccess(
  req: TarsRequest,
  res: Response,
  next: NextFunction,
): Promise<void> | void {
  const target = tarsScheduleTargetOf(req);
  if (target == null) {
    return next();
  }
  return answerKnowledgeAccess(req, res, next, target);
}
