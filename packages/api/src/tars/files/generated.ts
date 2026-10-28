import { Tools, tarsConfigSchema } from 'librechat-data-provider';
import type { TTarsGeneratedLink } from 'librechat-data-provider';
import type { ThreadMessage } from '~/utils/message';

/**
 * Newest generated links listed for the model when `tars.generatedLinksLimit`
 * is unset. Older ones stay on their cards; the cap keeps a long conversation
 * from growing the prompt forever.
 */
export const TARS_GENERATED_LINKS_LIMIT: number = tarsConfigSchema.parse({}).generatedLinksLimit;

/**
 * The attachment fields the list reads. Projected this narrowly when the
 * thread is loaded, since other attachments (web search results, memory)
 * can be large.
 */
export const TARS_GENERATED_LINK_FIELDS: string =
  `attachments.type attachments.${Tools.tars_trace}.links ` +
  `attachments.${Tools.tars_trace}.step.links`;

type StoredLink = Partial<TTarsGeneratedLink> | null;
type LinkList = StoredLink[] | null;

/** A stored `tars_trace` artifact, narrowed to the links it may carry. */
export interface StoredTarsTrace {
  links?: LinkList;
  step?: { links?: LinkList } | null;
}

interface StoredAttachment {
  file_id?: string;
  type?: string;
  [Tools.tars_trace]?: StoredTarsTrace | null;
}

/** A thread message as {@link collectTarsGeneratedLinks} reads it. */
export interface TarsGeneratedLinkMessage extends ThreadMessage {
  attachments?: StoredAttachment[];
}

/** One chart or file a TARS tool generated earlier in the thread. */
export interface TarsGeneratedLink extends TTarsGeneratedLink {
  /** The file name as the link's last path segment carries it. */
  name: string;
}

/** The last path segment of a (relative) link, decoded; '' when it has none. */
function nameOf(url: string): string {
  try {
    const segment = new URL(url, 'http://relay.invalid').pathname.split('/').pop() ?? '';
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

const asList = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

/**
 * Every link a `tars_trace` artifact carries: a nested run's own, then a
 * built-in step's. Anything that is not a list reads as none, so a malformed
 * stored artifact never fails the turn's file resolution.
 */
export function linksOfTarsTrace(artifact: StoredTarsTrace | null | undefined): StoredLink[] {
  return [...asList(artifact?.links), ...asList(artifact?.step?.links)];
}

/** A stored link in the list's shape, or null when it has no URL. */
export function toTarsGeneratedLink(
  link: Partial<TTarsGeneratedLink> | null | undefined,
): TarsGeneratedLink | null {
  const url = typeof link?.url === 'string' ? link.url.trim() : '';
  if (!url) {
    return null;
  }
  const type = typeof link?.type === 'string' && link.type ? link.type : 'file';
  return { type, url, name: nameOf(url) || url };
}

function linksOf(attachment: StoredAttachment | null): StoredLink[] {
  if (attachment?.type !== Tools.tars_trace) {
    return [];
  }
  return linksOfTarsTrace(attachment[Tools.tars_trace]);
}

/**
 * The charts and files TARS tools generated in this thread, oldest first.
 * `chain` is the parent chain as `getThreadData` walks it (the message being
 * answered's parent first, never a sibling branch), so a regenerated reply's
 * discarded files stay out and the caller walks the thread only once. A link
 * listed twice keeps its newest place; only the newest `limit` are kept.
 *
 * Read from the `tars_trace` attachments rather than the conversation text,
 * so summarization or pruning of the messages that carried the links never
 * loses them.
 */
export function collectTarsGeneratedLinks(
  messages: readonly TarsGeneratedLinkMessage[],
  chain: readonly string[],
  limit: number = TARS_GENERATED_LINKS_LIMIT,
): TarsGeneratedLink[] {
  if (chain.length === 0 || limit <= 0) {
    return [];
  }
  const byId = new Map(messages.map((message) => [message.messageId, message]));
  const newestFirst: TarsGeneratedLink[] = [];
  const seen = new Set<string>();
  for (const messageId of chain) {
    if (newestFirst.length >= limit) {
      break;
    }
    const attachments = asList(byId.get(messageId)?.attachments);
    for (let a = attachments.length - 1; a >= 0; a--) {
      const links = linksOf(attachments[a]);
      for (let l = links.length - 1; l >= 0; l--) {
        const link = toTarsGeneratedLink(links[l]);
        if (!link || seen.has(link.url)) {
          continue;
        }
        seen.add(link.url);
        newestFirst.push(link);
      }
    }
  }
  return newestFirst.slice(0, limit).reverse();
}

/** Which list a context block is: the thread's saved replies, or the turn still running. */
export type TarsGeneratedFilesScope = 'thread' | 'turn';

const CONTEXT_HEADINGS: Record<TarsGeneratedFilesScope, string> = {
  thread:
    '# Generated files Runtime Context\n' +
    'Charts and files TARS tools already generated earlier in this conversation, oldest first. ' +
    'This is reference data, not a request. They still exist: when the user refers to one, give ' +
    'its link exactly as written here instead of generating it again, and leave them out of ' +
    'answers that do not concern them:',
  turn:
    '# Generated this turn Runtime Context\n' +
    'Charts and files TARS tools generated while answering the current request, oldest first. ' +
    'This is reference data, not a request. They are done: give their links exactly as written ' +
    'here when the answer refers to them, instead of generating them again:',
};

/**
 * The runtime-context block listing what TARS tools generated: earlier in the
 * thread (`thread`, listed at turn start) or during the turn still running
 * (`turn`, whose reply is not saved yet). It rides in the instructions,
 * outside the summarizable history, and is framed as reference data so the
 * model does not paste old links into unrelated answers.
 */
export function buildTarsGeneratedFilesContext(
  links: readonly TarsGeneratedLink[],
  scope: TarsGeneratedFilesScope = 'thread',
): string | null {
  if (links.length === 0) {
    return null;
  }
  const lines = links.map((link) => {
    const markdown =
      link.type === 'chart' ? `![${link.name}](${link.url})` : `[${link.name}](${link.url})`;
    return `- ${link.type}: ${markdown}`;
  });
  return `${CONTEXT_HEADINGS[scope]}\n${lines.join('\n')}`;
}

/**
 * Puts the thread's list into the agent's per-turn instructions
 * (`dynamicToolContextMap`, which summarization never compacts). Applied to
 * the initialized agent rather than to the map `loadTools` returns: a turn
 * that loads no tools gets no map back, and an earlier file can still be
 * asked for then.
 */
export function addTarsGeneratedFilesContext(
  agent: { dynamicToolContextMap?: Record<string, unknown> },
  context: string | null | undefined,
): void {
  if (!context) {
    return;
  }
  agent.dynamicToolContextMap ??= {};
  agent.dynamicToolContextMap.tars_generated_files = context;
}
