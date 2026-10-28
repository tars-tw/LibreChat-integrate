import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTarsMcpSystemVariablesQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Lists the bindable `{{TARS_*}}` variables under a caller-supplied explanation,
 * with an opt-in reveal of what each resolves to for the signed-in admin.
 * Shared by every place a fixed value or static header may use them.
 */
export default function SystemVariablesHint({ hint }: { hint: string }) {
  const localize = useLocalize();
  const [showValues, setShowValues] = useState(false);
  const { data: variables = [] } = useTarsMcpSystemVariablesQuery();
  const toggleLabel = localize('com_ui_tars_mcp_fixed_value_preview');

  return (
    <div className="bg-surface-secondary text-text-secondary space-y-1 rounded-lg p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p>{hint}</p>
        {variables.length > 0 && (
          <button
            type="button"
            aria-label={toggleLabel}
            aria-pressed={showValues}
            title={toggleLabel}
            onClick={() => setShowValues((prev) => !prev)}
            className="hover:bg-surface-tertiary hover:text-text-primary shrink-0 rounded p-1"
          >
            {showValues ? <Eye className="icon-sm" /> : <EyeOff className="icon-sm" />}
          </button>
        )}
      </div>
      {variables.length > 0 && (
        <ul className="space-y-0.5">
          {variables.map(({ name, value }) => (
            <li key={name} className="break-all">
              <code className="bg-surface-tertiary text-text-primary rounded px-1">{`{{${name}}}`}</code>
              {showValues && <span className="ml-1">= {value ?? '-'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
