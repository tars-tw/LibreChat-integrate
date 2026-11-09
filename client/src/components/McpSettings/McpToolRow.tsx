import { Switch } from '@librechat/client';
import { useLocalize } from '~/hooks';

/** One tool in an admin server panel, with the switch that turns it on or off. */
export default function McpToolRow({
  name,
  description,
  enabled,
  disabled,
  onChange,
}: {
  name: string;
  description?: string | null;
  enabled: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const localize = useLocalize();
  return (
    <li className="flex items-start justify-between gap-3 px-2 py-2">
      <div className="min-w-0 flex-1">
        <span className="bg-surface-tertiary text-text-primary inline-block rounded px-1.5 py-0.5 font-mono text-xs">
          {name}
        </span>
        {description != null && description !== '' && (
          <p className="text-text-secondary mt-1 text-xs break-words whitespace-normal">
            {description}
          </p>
        )}
      </div>
      <Switch
        aria-label={localize('com_ui_tars_mcp_tool_enabled', { name })}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </li>
  );
}
