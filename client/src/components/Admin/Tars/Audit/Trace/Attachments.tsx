import { useState } from 'react';
import { Button, TooltipAnchor } from '@librechat/client';
import { Image, Sheet, FileText, FileInput, Paperclip } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OverviewAttachment } from './documents';
import { MemoryDocument } from './Parts';
import { useLocalize } from '~/hooks';
import { ownValue } from './values';

/** How each file reached the model, by its `injected_as`. */
const INJECTION_ICONS: Record<string, LucideIcon> = {
  summary: FileText,
  provider: FileInput,
  image: Image,
  data_file: Sheet,
  attachment: Paperclip,
};

/** A long thread can hold many files; the rest wait behind a toggle. */
const VISIBLE_COUNT = 5;

/**
 * The overview's attachment list: each file once, its icon saying how the
 * model read it (named on hover), downloadable when it has an id, and this
 * message's own uploads listed first.
 */
export default function AttachmentList({ files }: { files: OverviewAttachment[] }) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, VISIBLE_COUNT);
  const hiddenCount = files.length - shown.length;

  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {shown.map((file, index) => {
        const Icon = ownValue(INJECTION_ICONS, file.injectedAs) ?? Paperclip;
        const label = localize(file.labelKey);
        return (
          <li
            key={`${file.id ?? file.filename}-${index}`}
            className="inline-flex items-center gap-1"
          >
            <TooltipAnchor
              description={label}
              render={
                <span role="img" aria-label={label} className="text-text-tertiary inline-flex">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
              }
            />
            <MemoryDocument id={file.id} filename={file.filename} inline />
          </li>
        );
      })}
      {files.length > VISIBLE_COUNT && (
        <li>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? localize('com_ui_tars_audit_trace_show_less')
              : localize('com_ui_tars_audit_trace_show_more', { count: hiddenCount })}
          </Button>
        </li>
      )}
    </ul>
  );
}
