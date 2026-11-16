import { Label, TooltipAnchor, CircleHelpIcon } from '@librechat/client';
import { useLocalize } from '~/hooks';

/** A form label with a help button, which keyboard users can reach as well as a mouse can. */
export default function FieldLabel({
  htmlFor,
  label,
  help,
  required = false,
  portalElement,
}: {
  htmlFor: string;
  label: string;
  help: string;
  /** Marks the label with the form's `*`. */
  required?: boolean;
  portalElement?: HTMLElement | null;
}) {
  const localize = useLocalize();
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{required ? `${label} *` : label}</Label>
      <TooltipAnchor
        description={help}
        side="top"
        portalElement={portalElement}
        render={
          <button
            type="button"
            aria-label={localize('com_ui_tars_field_help', { field: label })}
            className="text-text-tertiary hover:text-text-primary rounded"
          >
            <CircleHelpIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
