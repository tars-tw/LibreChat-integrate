import { useFormContext, useWatch } from 'react-hook-form';
import { hasTarsKnowledgeSearch } from 'librechat-data-provider';
import {
  Switch,
  HoverCard,
  HoverCardPortal,
  HoverCardContent,
  HoverCardTrigger,
  CircleHelpIcon,
} from '@librechat/client';
import type { AgentForm } from '~/common';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';

const SWITCH_ID = 'agent-tars-source-download';
const LABEL_ID = `${SWITCH_ID}-label`;

/**
 * 參考資料下載 — lets the files a knowledge search cites be downloaded from the
 * answer's 資料來源 line. Only meaningful with the knowledge search equipped,
 * so it is shown only then.
 */
export default function SourceDownload() {
  const localize = useLocalize();
  const { control, setValue } = useFormContext<AgentForm>();
  const tools = useWatch({ control, name: 'tools' });
  const enabled = useWatch({ control, name: 'tars_source_download' });

  if (!hasTarsKnowledgeSearch(tools)) {
    return null;
  }

  return (
    <HoverCard openDelay={50}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <label
            id={LABEL_ID}
            htmlFor={SWITCH_ID}
            className="text-text-secondary block text-xs font-medium tracking-wide uppercase"
          >
            {localize('com_ui_tars_source_download')}
          </label>
          <HoverCardTrigger>
            <span className="text-text-tertiary">
              <CircleHelpIcon className="h-4 w-4" />
            </span>
          </HoverCardTrigger>
        </div>
        <HoverCardPortal>
          <HoverCardContent side={ESide.Top} className="w-80">
            <p className="text-text-secondary text-sm">
              {localize('com_ui_tars_source_download_info')}
            </p>
          </HoverCardContent>
        </HoverCardPortal>
        <Switch
          id={SWITCH_ID}
          checked={enabled === true}
          onCheckedChange={(value: boolean) =>
            setValue('tars_source_download', value, { shouldDirty: true })
          }
          data-testid={SWITCH_ID}
          aria-labelledby={LABEL_ID}
        />
      </div>
    </HoverCard>
  );
}
