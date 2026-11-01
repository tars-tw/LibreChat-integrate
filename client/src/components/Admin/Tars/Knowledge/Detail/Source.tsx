import {
  FileQuestion,
  HardDrive,
  KeyRound,
  Network,
  Server,
  ServerCog,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Localize } from './helpers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** One icon and series color per pwc_tars `file_source`; `MANUAL` keeps the plain text color. */
const SOURCE_ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  MANUAL: { Icon: Upload, color: 'text-text-primary' },
  FTP: { Icon: Server, color: 'text-series-1' },
  SFTP: { Icon: KeyRound, color: 'text-series-2' },
  SMB: { Icon: Network, color: 'text-series-3' },
  NFS: { Icon: HardDrive, color: 'text-series-4' },
  SERVER: { Icon: ServerCog, color: 'text-series-6' },
};

/** Display text only: filters and pwc_tars keep the stored value. Protocol names read as they are. */
export const sourceLabel = (source: string, localize: Localize): string => {
  const name = source.trim().toUpperCase();
  return name === 'MANUAL' ? localize('com_ui_tars_kb_ds_source_manual') : name;
};

/** Where a document came from; its name stays available as the tooltip and accessible label. */
export default function SourceIcon({ source }: { source?: string | null }) {
  const localize = useLocalize();
  const name = source?.trim().toUpperCase();
  if (!name) {
    return <span className="text-text-secondary">—</span>;
  }
  const known = SOURCE_ICONS[name];
  const Icon = known?.Icon ?? FileQuestion;
  const label = sourceLabel(name, localize);
  return (
    <span title={label} className="inline-flex">
      <Icon
        role="img"
        aria-label={label}
        className={cn('size-4', known?.color ?? 'text-text-secondary')}
      />
    </span>
  );
}
