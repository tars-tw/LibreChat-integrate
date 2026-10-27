import { Spinner } from '@librechat/client';
import { embeddingPurposeLabel } from '../TokenQuota/Report/embedding';
import { useTarsMessageEmbeddingUsageQuery } from '~/data-provider';
import { formatTokens } from '../TokenQuota/Report/helpers';
import { useLocalize } from '~/hooks';

/**
 * The embedding tokens one audited message spent (knowledge-base searches and
 * memory lookups), one row per purpose, model and knowledge base. A LibreChat
 * turn's response messageId is the pwc_tars message id, so mirrored chats show
 * here too. Left out on any failed load, so the response above stays readable.
 */
export default function MessageEmbeddingUsage({ messageId }: { messageId: string }) {
  const localize = useLocalize();
  const { data, isLoading, isError } = useTarsMessageEmbeddingUsageQuery(messageId);

  if (isError) {
    return null;
  }
  const rows = data?.rows ?? [];
  const total = rows.reduce((sum, row) => sum + row.input_tokens, 0);

  return (
    <div>
      <p className="text-text-secondary mb-1 text-xs font-semibold tracking-wide uppercase">
        {localize('com_ui_tars_embedding_title')}
        {rows.length > 0 && (
          <span className="ml-2 normal-case tabular-nums">
            {localize('com_ui_tars_embedding_total_tokens', { 0: formatTokens(total) })}
          </span>
        )}
      </p>
      {isLoading && <Spinner className="size-4" />}
      {!isLoading && rows.length === 0 && (
        <p className="text-text-secondary text-sm">{localize('com_ui_tars_embedding_none')}</p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-text-secondary text-left">
            <tr>
              <th className="px-2 py-1 font-medium">
                {localize('com_ui_tars_embedding_col_purpose')}
              </th>
              <th className="px-2 py-1 font-medium">
                {localize('com_ui_tars_embedding_col_model')}
              </th>
              <th className="px-2 py-1 font-medium">
                {localize('com_ui_tars_embedding_group_knowledge_base')}
              </th>
              <th className="px-2 py-1 text-right font-medium">
                {localize('com_ui_tars_embedding_col_tokens')}
              </th>
              <th className="px-2 py-1 text-right font-medium">
                {localize('com_ui_tars_embedding_requests')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-border-light border-t">
                <td className="text-text-primary px-2 py-1">
                  {embeddingPurposeLabel(row.purpose, localize)}
                </td>
                <td className="text-text-primary px-2 py-1">{row.embedding_model_name ?? '-'}</td>
                <td className="text-text-secondary px-2 py-1">
                  {row.knowledge_base_id ?? localize('com_ui_tars_embedding_unattributed')}
                </td>
                <td className="text-text-primary px-2 py-1 text-right tabular-nums">
                  {formatTokens(row.input_tokens)}
                </td>
                <td className="text-text-secondary px-2 py-1 text-right tabular-nums">
                  {formatTokens(row.request_count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
