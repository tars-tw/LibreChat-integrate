import { useState } from 'react';
import { useToastContext } from '@librechat/client';
import {
  useGetUserQuery,
  useUpdateMemoryPreferencesMutation,
  useUpdateTarsMemoryPreferencesMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

export type TarsMemoryMode = 'auto' | 'manual' | 'off';

/**
 * The memory mode, shared by the panel and the settings dialog. One choice over the two
 * stored preferences: `memories` (is memory used at all) and `memoryAutoUpdate` (may the AI
 * change it), so the combination that would make the second meaningless cannot be picked.
 */
export default function useMode() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const memories = useUpdateMemoryPreferencesMutation();
  const upkeep = useUpdateTarsMemoryPreferencesMutation();
  const [pending, setPending] = useState<TarsMemoryMode | null>(null);

  const memoryEnabled = user?.personalization?.memories !== false;
  const autoUpdate = user?.personalization?.memoryAutoUpdate !== false;
  const onMode: TarsMemoryMode = autoUpdate ? 'auto' : 'manual';
  const storedMode = memoryEnabled ? onMode : 'off';
  const mode = pending ?? storedMode;

  const setMode = async (value: string) => {
    const next = value as TarsMemoryMode;
    setPending(next);
    try {
      /** Upkeep first, so memory never comes back on under the mode being left. */
      if (next !== 'off' && (next === 'auto') !== autoUpdate) {
        await upkeep.mutateAsync(next === 'auto');
      }
      if ((next !== 'off') !== memoryEnabled) {
        await memories.mutateAsync({ memories: next !== 'off' });
      }
      showToast({ message: localize('com_ui_preferences_updated'), status: 'success' });
    } catch {
      showToast({ message: localize('com_ui_error_updating_preferences'), status: 'error' });
    } finally {
      setPending(null);
    }
  };

  return {
    mode,
    modeOptions: [
      { value: 'auto', label: localize('com_ui_tars_memory_mode_auto') },
      { value: 'manual', label: localize('com_ui_tars_memory_mode_manual') },
      { value: 'off', label: localize('com_ui_tars_memory_mode_off') },
    ],
    setMode,
    isSaving: pending != null,
  };
}
