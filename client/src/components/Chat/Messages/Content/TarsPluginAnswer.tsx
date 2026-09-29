import { memo, useMemo } from 'react';
import type { TAttachment } from 'librechat-data-provider';
import { getTarsPluginAnswer, splitTarsAnswer } from './tars';
import MarkdownLite from './MarkdownLite';

/**
 * The answer of a pwc_tars plugin that ends the turn (`ends_turn`), shown
 * verbatim under its tool call. In pwc_tars this text is the reply itself; a
 * model asked to relay it drops the rule trail and can shift table cells, so
 * the chat shows the plugin's own text and the model only adds a line after it.
 */
function TarsPluginAnswer({
  attachments,
  toolCallId,
}: {
  attachments?: TAttachment[];
  toolCallId?: string;
}) {
  const answer = getTarsPluginAnswer(attachments, toolCallId);
  const blocks = useMemo(() => (answer ? splitTarsAnswer(answer) : []), [answer]);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div
      className="markdown prose message-content dark:prose-invert light my-2 w-full break-words"
      data-testid="tars-plugin-answer"
    >
      {blocks.map((block, index) =>
        block.type === 'markdown' ? (
          <MarkdownLite key={index} content={block.content} codeExecution={false} />
        ) : (
          <details key={index} className="my-2 rounded-lg border border-border-light px-3 py-1">
            <summary className="cursor-pointer text-sm text-text-secondary">
              {block.summary}
            </summary>
            <MarkdownLite content={block.content} codeExecution={false} />
          </details>
        ),
      )}
    </div>
  );
}

export default memo(TarsPluginAnswer);
