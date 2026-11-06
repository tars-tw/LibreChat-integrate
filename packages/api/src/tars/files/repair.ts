import { logger } from '@librechat/data-schemas';
import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { signedTarsAssets } from '~/tars/assets';

/** An agent whose per-turn context may list the thread's earlier generated files. */
export interface TarsGeneratedLinkSource {
  dynamicToolContextMap?: Record<string, unknown>;
}

const GENERATED_FILES_CONTEXT_KEY = 'tars_generated_files';

/** The target of a markdown link or image, up to the first space or parenthesis. */
const LINK_TARGET = /(\]\(\s*<?)([^\s()<>]+)/g;

/** The decoded last segment of a link, whatever scheme or host the model put in front of it. */
function fileNameOf(target: string): string {
  const path = target.split(/[?#]/, 1)[0];
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf(':')) + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function toolOutputOf(part: TMessageContentParts): string | undefined {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return undefined;
  }
  const output = (part.tool_call as { output?: unknown } | undefined)?.output;
  return typeof output === 'string' ? output : undefined;
}

/**
 * The relay link of every file a TARS tool generated, by file name: from this
 * turn's tool results and the thread's earlier list. A name two different
 * files share is left out, since a reply naming it cannot be resolved.
 */
function generatedLinksByName(
  parts: readonly TMessageContentParts[],
  agents: Iterable<TarsGeneratedLinkSource | null | undefined>,
): Map<string, string> {
  const sources: string[] = [];
  for (const part of parts) {
    const output = part ? toolOutputOf(part) : undefined;
    if (output) {
      sources.push(output);
    }
  }
  for (const agent of agents) {
    const context = agent?.dynamicToolContextMap?.[GENERATED_FILES_CONTEXT_KEY];
    if (typeof context === 'string') {
      sources.push(context);
    }
  }
  const byName = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const { name, link } of sources.flatMap(signedTarsAssets)) {
    const known = byName.get(name);
    if (known != null && known !== link) {
      ambiguous.add(name);
    }
    byName.set(name, link);
  }
  ambiguous.forEach((name) => byName.delete(name));
  return byName;
}

function repairText(text: string, byName: ReadonlyMap<string, string>): string {
  return text.replace(LINK_TARGET, (match: string, opening: string, target: string) => {
    const link = byName.get(fileNameOf(target));
    if (!link || target === link || signedTarsAssets(target).length > 0) {
      return match;
    }
    return `${opening}${link}`;
  });
}

function repairPart(
  part: TMessageContentParts,
  byName: ReadonlyMap<string, string>,
): TMessageContentParts {
  if (part?.type !== ContentTypes.TEXT || part.text == null) {
    return part;
  }
  if (typeof part.text === 'string') {
    const text = repairText(part.text, byName);
    return text === part.text ? part : { ...part, text };
  }
  const value = repairText(part.text.value, byName);
  return value === part.text.value ? part : { ...part, text: { ...part.text, value } };
}

/**
 * Points the reply's links to files TARS tools generated back at the relay
 * links those tools returned. Models asked to copy a link verbatim still
 * rewrite it — a `sandbox:` prefix, an invented host, the signature dropped —
 * and the result opens nothing. A link is repaired only when its file name is
 * one a validly signed tool result names, so the model cannot obtain a link to
 * any other file this way. Returns `parts` itself when nothing changed.
 */
export function repairTarsGeneratedLinks(
  parts: TMessageContentParts[],
  agents: Iterable<TarsGeneratedLinkSource | null | undefined>,
): TMessageContentParts[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return parts;
  }
  const byName = generatedLinksByName(parts, agents);
  if (byName.size === 0) {
    return parts;
  }
  let repaired = 0;
  const result = parts.map((part) => {
    const next = repairPart(part, byName);
    if (next !== part) {
      repaired += 1;
    }
    return next;
  });
  if (repaired === 0) {
    return parts;
  }
  logger.info(
    `[tars-files] Repaired generated-file links the model rewrote in ${repaired} part(s)`,
  );
  return result;
}
