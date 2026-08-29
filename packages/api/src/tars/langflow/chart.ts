import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import { langflowTimeoutMs, runLangflowCapability, resolveLangflowModelName } from './client';
import { TarsRequestError } from '~/tars/client';

export const TARS_CHART_TOOL_NAME: Tools = Tools.chart_agent;

const CHART_PATH = '/api/langflow-service/chart';
/** pwc_tars caps one synchronous capability turn at 300s; surface our own timeout first. */
const DEFAULT_TIMEOUT_MS = 240_000;

const TARS_CHART_DESCRIPTION: string =
  'Render a chart as a PNG image. Sends a plain-language chart request to the TARS chart agent, ' +
  'which writes and executes plotting code server-side and returns a markdown image link — ' +
  'include that link verbatim in your reply so the user sees the chart. The agent only sees the ' +
  'request text, so copy the actual data to plot (numbers from earlier tool results or the ' +
  'conversation) into the request together with the chart type, axes, and title.';

const TARS_CHART_JSON_SCHEMA = {
  type: 'object',
  properties: {
    request: {
      type: 'string',
      description:
        'A complete chart request in plain language, containing the data values to plot, the chart type, and labels. Write titles/labels in the language the user is using.',
    },
  },
  required: ['request'],
} as const;

interface TarsChartToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_CHART_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsChartToolDefinition: TarsChartToolDefinitionShape = {
  name: TARS_CHART_TOOL_NAME as string,
  description: TARS_CHART_DESCRIPTION,
  schema: TARS_CHART_JSON_SCHEMA,
};

const chartAgentSchema = z.object({
  request: z
    .string()
    .describe(
      'A complete chart request in plain language, containing the data values to plot, the ' +
        'chart type, and labels. Write titles/labels in the language the user is using.',
    ),
});

export interface TarsChartToolOptions {
  /** Model the chat turn runs on; the nested pwc_tars loop inherits it. */
  model?: string;
  /** The account the LLM gateway resolves models and quota for. */
  librechatUserId?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pwc_tars chart capability as one native LibreChat tool. pwc_tars renders
 * the PNG under its unauthenticated `/static` tree and reports its URL; the
 * answer usually embeds it already, so the image link is only appended when the
 * agent forgot to.
 */
export function createTarsChartTool(options: TarsChartToolOptions): DynamicStructuredTool {
  return tool(
    async (input: z.infer<typeof chartAgentSchema>): Promise<string> => {
      try {
        const requestedModel = await resolveLangflowModelName(options.model, 'tars-chart');
        const data = await runLangflowCapability(
          CHART_PATH,
          { query: input.request, model_name: requestedModel },
          {
            timeoutMs: langflowTimeoutMs('TARS_CHART_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
            librechatUserId: options.librechatUserId,
          },
        );
        logger.debug(
          `[tars-chart] requested=${requestedModel ?? '(pwc_tars default)'} ` +
            `used=${data.model_name ?? '(unreported)'} tokens=${data.tokens?.total ?? 0} ` +
            `chart=${data.chart_url ? 'yes' : 'no'} gateway=requested`,
        );
        const answer = data.answer?.trim() ?? '';
        const chartUrl = data.chart_url?.trim() ?? '';
        if (!chartUrl) {
          return answer || 'The chart agent returned no chart.';
        }
        if (answer.includes(chartUrl)) {
          return answer;
        }
        return `${answer}\n\n![chart](${chartUrl})`.trim();
      } catch (error) {
        return `Chart generation failed: ${toErrorMessage(error)}`;
      }
    },
    {
      name: TARS_CHART_TOOL_NAME,
      description: TARS_CHART_DESCRIPTION,
      schema: chartAgentSchema,
    },
  ) as unknown as DynamicStructuredTool;
}
