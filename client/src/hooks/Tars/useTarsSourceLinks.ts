import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Tools } from 'librechat-data-provider';
import type { TAttachment, TMessage } from 'librechat-data-provider';
import { useGetAgentByIdQuery, useGetMessagesByConvoId } from '~/data-provider';
import { messageAttachmentsMapAtom } from '~/hooks/SSE/atoms';
import { useMessageContext } from '~/Providers';

/** The relay route the knowledge search signs its links for (`TARS_SOURCE_ROUTE`). */
const SOURCE_ROUTE = '/api/tars/kb-files/';
/** Where an answer lists the files it drew on; only names after it are linked. */
const SOURCES_KEYWORD = '資料來源';
/** The switch is re-read by the relay on every download; the link shown may lag this long. */
const AGENT_STALE_MS = 30_000;

type SourceLinks = ReadonlyMap<string, string>;

/** Whether an answer lists its sources, the only text the links are added to. */
export const hasTarsSourcesKeyword = (text: string): boolean => text.includes(SOURCES_KEYWORD);

/** The agent a relay link was minted for: `/api/tars/kb-files/<agent>/<kb>/<doc>?sig=`. */
export function tarsSourceLinkAgent(url: string): string | undefined {
  if (!url.startsWith(SOURCE_ROUTE)) {
    return undefined;
  }
  return url.slice(SOURCE_ROUTE.length).split('/')[0] || undefined;
}

function addLinks(links: Map<string, string>, attachments: TAttachment[] | undefined): void {
  for (const attachment of attachments ?? []) {
    if (attachment.type !== Tools.tars_trace) {
      continue;
    }
    for (const source of attachment[Tools.tars_trace]?.step?.sources ?? []) {
      if (source.url && !links.has(source.filename)) {
        links.set(source.filename, source.url);
      }
    }
  }
}

/**
 * The cited files an answer may link, by file name: what its own searches
 * found, then what the answers above it found (its parent chain, never a
 * sibling branch), so a follow-up that answers from an earlier search keeps
 * the links. The nearest search wins a name. Only links minted for the agent
 * that wrote this answer count; `agentId` is that agent.
 */
export function collectTarsSourceLinks(
  messages: readonly TMessage[] | undefined,
  messageId: string,
  liveAttachments?: TAttachment[],
): { agentId?: string; links: Map<string, string> } {
  const links = new Map<string, string>();
  addLinks(links, liveAttachments);
  const byId = new Map((messages ?? []).map((message) => [message.messageId, message]));
  const current = byId.get(messageId);
  const seen = new Set<string>();
  for (let message = current; message && !seen.has(message.messageId); ) {
    seen.add(message.messageId);
    addLinks(links, message.attachments);
    message = message.parentMessageId ? byId.get(message.parentMessageId) : undefined;
  }
  const agentId =
    current?.model ?? tarsSourceLinkAgent(links.values().next().value ?? '') ?? undefined;
  for (const [filename, url] of links) {
    if (tarsSourceLinkAgent(url) !== agentId) {
      links.delete(filename);
    }
  }
  return { agentId, links };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLinkText = (value: string): string => value.replace(/([\\[\]])/g, '\\$1');

const stemOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
};

/**
 * The answer with each cited file named after its last 資料來源 turned into
 * that file's download link. A name counts written in full or without its
 * extension, exactly; a stem two files share names neither and stays text.
 */
export function linkTarsSources(text: string, links: SourceLinks): string {
  const at = text.lastIndexOf(SOURCES_KEYWORD);
  if (at < 0 || links.size === 0) {
    return text;
  }
  const targets = new Map<string, string>(links);
  const shared = new Set<string>();
  for (const [filename, url] of links) {
    const stem = stemOf(filename);
    if (links.has(stem)) {
      continue;
    }
    const known = targets.get(stem);
    if (known != null && known !== url) {
      shared.add(stem);
    }
    targets.set(stem, url);
  }
  shared.forEach((stem) => targets.delete(stem));
  const names = [...targets.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) {
    return text;
  }
  const pattern = new RegExp(names.map(escapeRegExp).join('|'), 'g');
  const tail = text
    .slice(at)
    .replace(pattern, (name) => `[${escapeLinkText(name)}](${targets.get(name)})`);
  return text.slice(0, at) + tail;
}

/**
 * An answer's text with the files under its 資料來源 linked for download,
 * while the agent that wrote it still offers them (參考資料下載). Text without
 * searched files comes back untouched. Reads the conversation from the chat's
 * caches, so it is only mounted for an answer that has a 資料來源.
 */
export default function useTarsSourceLinks(text: string): string {
  const { messageId, conversationId } = useMessageContext();
  const { data: messages } = useGetMessagesByConvoId(conversationId ?? '', { enabled: false });
  const attachmentsMap = useAtomValue(messageAttachmentsMapAtom);
  const liveAttachments = attachmentsMap[messageId];

  const { agentId, links } = useMemo(
    () => collectTarsSourceLinks(messages, messageId, liveAttachments),
    [messages, messageId, liveAttachments],
  );
  const { data: agent } = useGetAgentByIdQuery(links.size > 0 ? agentId : undefined, {
    staleTime: AGENT_STALE_MS,
  });
  const enabled = agent?.tars_source_download === true;

  return useMemo(() => (enabled ? linkTarsSources(text, links) : text), [enabled, text, links]);
}
