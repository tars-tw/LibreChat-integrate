import { useId, useState } from 'react';
import {
  Button,
  Chip,
  Dropdown,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetLevelInput, TTarsDataSecurityLevel } from 'librechat-data-provider';
import { useSetTarsDatasetLevelMutation } from '~/data-provider';
import { relayedError } from '../helpers';
import { useLocalize } from '~/hooks';

/** `Dropdown` treats `''` as nothing selected, so "no level" needs a value of its own. */
const NO_LEVEL = '__none__';

/** A dataset's level; `levels` arrive highest first, and only the top one reads as the alarm. */
export function LevelChip({
  levels,
  levelId,
}: {
  levels: TTarsDataSecurityLevel[];
  levelId?: string | null;
}) {
  if (levelId == null) {
    return <span className="text-text-secondary">—</span>;
  }
  const index = levels.findIndex((level) => level.id === levelId);
  return (
    <Chip tone={index === 0 ? 'error' : 'warning'}>
      <span className="whitespace-nowrap">{levels[index]?.name ?? levelId}</span>
    </Chip>
  );
}

/** Pick a level or none. `undefined` shows the placeholder, so nothing is chosen by default. */
export function LevelSelect({
  labelId,
  levels,
  value,
  onChange,
  placeholder,
}: {
  labelId: string;
  levels: TTarsDataSecurityLevel[];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const localize = useLocalize();

  return (
    <Dropdown
      value={value === undefined ? '' : (value ?? NO_LEVEL)}
      onChange={(next) => onChange(next === NO_LEVEL ? null : next)}
      options={[
        { value: NO_LEVEL, label: localize('com_ui_tars_kb_level_none') },
        ...levels.map((level) => ({ value: level.id, label: level.name })),
      ]}
      aria-labelledby={labelId}
      placeholder={placeholder}
      sizeClasses="w-full"
      className="w-full"
    />
  );
}

/**
 * Sets the level of one dataset or a selection. A selection passes no `currentLevelId`:
 * its rows may differ, so nothing is preselected and clearing them must be picked.
 */
export default function LevelDialog({
  knowledgeBaseId,
  levels,
  name,
  targets,
  currentLevelId,
  note,
  onSaved,
  onClose,
}: {
  knowledgeBaseId: string;
  levels: TTarsDataSecurityLevel[];
  /** What is being changed: a dataset's name or how many are selected. */
  name: string;
  targets: Omit<TTarsDatasetLevelInput, 'dataSecurityLevelId'>;
  currentLevelId?: string | null;
  /** An extra consequence worth spelling out, shown in a bordered block. */
  note?: string;
  onSaved?: () => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const labelId = useId();
  const [value, setValue] = useState<string | null | undefined>(currentLevelId);

  const setLevelMutation = useSetTarsDatasetLevelMutation(knowledgeBaseId, {
    onSuccess: ({ result }) => {
      showToast({
        message:
          result.file_system_count > 0
            ? localize('com_ui_tars_kb_level_group_saved', {
                0: String(result.inherited_document_count),
              })
            : localize('com_ui_tars_kb_level_saved'),
        status: 'success',
      });
      onSaved?.();
      onClose();
    },
    onError: (error) =>
      showToast({
        message: relayedError(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const canSave = value !== undefined && value !== currentLevelId && !setLevelMutation.isLoading;

  return (
    <OGDialog open onOpenChange={(open) => !open && !setLevelMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_level_set')}
        className="w-11/12 max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-3">
            <p className="text-text-secondary text-sm break-words">{name}</p>
            <div className="space-y-1.5">
              <Label id={labelId}>{localize('com_ui_tars_kb_level')}</Label>
              <LevelSelect
                labelId={labelId}
                levels={levels}
                value={value}
                onChange={setValue}
                placeholder={localize('com_ui_tars_kb_level_pick')}
              />
            </div>
            {note != null && (
              <p className="border-border-light text-text-secondary rounded-lg border p-3 text-sm">
                {note}
              </p>
            )}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={!canSave}
            onClick={() =>
              setLevelMutation.mutate({ ...targets, dataSecurityLevelId: value ?? null })
            }
          >
            {setLevelMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
