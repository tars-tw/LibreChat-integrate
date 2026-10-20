import { cn } from '~/utils';

/**
 * Row action icon colors shared by every MCP settings tab, so one icon reads the same
 * everywhere — the palette of 人員管理: details amber, credentials cyan, delete red, and
 * every other action (edit, cancel, test, sync, preview) neutral grey.
 */
export type McpActionTone = 'info' | 'key' | 'danger' | 'neutral';

const TONE_CLASSES: Record<McpActionTone, string> = {
  info: 'text-pwc-info',
  key: 'text-pwc-info-cyan',
  danger: 'text-text-destructive',
  neutral: 'text-text-secondary hover:text-text-primary',
};

/** An icon-only row action button in the given tone. */
export const mcpActionClass = (tone: McpActionTone, className?: string): string =>
  cn(
    'hover:bg-surface-tertiary rounded p-1.5 disabled:cursor-not-allowed disabled:opacity-40',
    TONE_CLASSES[tone],
    className,
  );
