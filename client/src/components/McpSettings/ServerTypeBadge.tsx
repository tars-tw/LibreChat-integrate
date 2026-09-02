import { useLocalize } from '~/hooks';

const TYPE_LABEL_KEYS = {
  openapi: 'com_ui_tars_mcp_type_openapi',
  external: 'com_ui_tars_mcp_type_external',
  custom_api: 'com_ui_tars_mcp_type_custom',
} as const;

/** Distinguishes server types at a glance, matching pwc_tars's own type-badge colors. */
const TYPE_STYLES: Record<string, string> = {
  openapi: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  external: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  custom_api: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
};

/** Color-coded server-type pill shared by every MCP settings tab. */
export default function ServerTypeBadge({ type }: { type: string }) {
  const localize = useLocalize();

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
        TYPE_STYLES[type] ?? TYPE_STYLES.custom_api
      }`}
    >
      {localize(
        TYPE_LABEL_KEYS[type as keyof typeof TYPE_LABEL_KEYS] ?? 'com_ui_tars_mcp_type_custom',
      )}
    </span>
  );
}
