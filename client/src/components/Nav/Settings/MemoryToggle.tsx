import { Dropdown, InfoHoverCard, ESide } from '@librechat/client';
import useMode from '~/components/SidePanel/Memories/Tars/useMode';
import { useLocalize } from '~/hooks';

export default function MemoryToggle() {
  const localize = useLocalize();
  const { mode, modeOptions, setMode, isSaving } = useMode();
  const labelId = 'memory-mode-label';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center space-x-2">
        <span id={labelId}>{localize('com_ui_tars_memory_mode')}</span>
        <InfoHoverCard side={ESide.Bottom} text={localize('com_ui_tars_memory_mode_description')} />
      </div>
      <Dropdown
        value={mode}
        onChange={setMode}
        options={modeOptions}
        className="z-50"
        disabled={isSaving}
        aria-labelledby={labelId}
      />
    </div>
  );
}
