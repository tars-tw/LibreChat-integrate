import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { DATASET_STATS, datasetCount } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * The five dataset counters a knowledge base carries. A kind the base has none
 * of is dimmed rather than hidden, so the row of icons stays in the same order
 * across every card and every row.
 */
export default function DatasetStats({
  knowledgeBase,
  className,
}: {
  knowledgeBase: TTarsKnowledgeBase;
  className?: string;
}) {
  const localize = useLocalize();

  return (
    <div className={`flex items-center gap-3 whitespace-nowrap text-xs ${className ?? ''}`}>
      {DATASET_STATS.map(({ key, icon: Icon, labelKey }) => {
        const count = datasetCount(knowledgeBase, key);
        const label = localize(labelKey);
        const tone = count > 0 ? 'text-text-primary' : 'text-text-tertiary';
        return (
          <span key={key} className={`flex items-center gap-1 ${tone}`} title={label}>
            <Icon className="size-3.5" aria-hidden />
            {/* The database column is a yes/no flag in pwc_tars, not a count. */}
            {key === 'database' ? (
              <span className="sr-only">{label}</span>
            ) : (
              <span className="tabular-nums">
                <span className="sr-only">{label} </span>
                {count}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
