import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TTarsMcpParsedSpec, TTarsMcpParsedTool } from 'librechat-data-provider';
import { endpointOf } from './boundValues';
import { useLocalize } from '~/hooks';

/** pwc_tars joins an operation's summary and description with a blank line. */
function splitToolDescription(description = ''): { summary: string; details: string } {
  const text = description.replace(/\r\n/g, '\n').trim();
  const blankLineAt = text.search(/\n\s*\n/);
  if (blankLineAt === -1) {
    return { summary: text, details: '' };
  }
  return { summary: text.slice(0, blankLineAt).trim(), details: text.slice(blankLineAt).trim() };
}

function ParsedToolRow({ tool }: { tool: TTarsMcpParsedTool }) {
  const [expanded, setExpanded] = useState(false);
  const { summary, details } = splitToolDescription(tool.description);

  const header = (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {tool.method != null && (
          <span className="bg-surface-tertiary text-text-secondary w-16 shrink-0 rounded py-0.5 text-center font-mono text-xs font-medium">
            {tool.method.toUpperCase()}
          </span>
        )}
        <span className="text-text-primary font-mono text-xs font-medium break-all">
          {tool.name}
        </span>
        <span className="text-text-secondary font-mono text-xs break-all">{tool.path}</span>
      </span>
      {summary !== '' && (
        <span className="text-text-secondary mt-1 block text-xs break-words whitespace-pre-line">
          {summary}
        </span>
      )}
    </span>
  );

  return (
    <li className="py-2">
      {details === '' ? (
        <div className="flex items-start gap-2">
          <span className="icon-sm shrink-0" />
          {header}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="hover:bg-surface-hover flex w-full items-start gap-2 rounded text-start"
        >
          {expanded ? (
            <ChevronDown className="icon-sm text-accent-primary mt-0.5 shrink-0" />
          ) : (
            <ChevronRight className="icon-sm text-text-secondary mt-0.5 shrink-0" />
          )}
          {header}
        </button>
      )}
      {expanded && (
        <p className="text-text-secondary mt-2 ml-6 text-xs break-words whitespace-pre-line">
          {details}
        </p>
      )}
    </li>
  );
}

/** What a parsed OpenAPI spec would import: one row per tool, details on demand. */
export default function McpParsedTools({ spec }: { spec: TTarsMcpParsedSpec }) {
  const localize = useLocalize();
  const tools = spec.tools ?? [];

  return (
    <div className="bg-surface-secondary rounded-lg p-3 text-sm">
      <p className="text-text-primary mb-2 font-medium">
        {localize('com_ui_tars_mcp_parse_result', { count: spec.tool_count ?? tools.length })}
      </p>
      <ul className="divide-border-medium max-h-80 divide-y overflow-y-auto">
        {tools.map((tool) => (
          <ParsedToolRow key={endpointOf(tool)} tool={tool} />
        ))}
      </ul>
    </div>
  );
}
