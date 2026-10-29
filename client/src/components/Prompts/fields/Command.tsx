import { useId, useRef, useState, useEffect } from 'react';
import { Input } from '@librechat/client';
import { SquareSlash } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** LibreChat prompt groups only accept lowercase ASCII commands; `allowUnicode`
 *  keeps letters and digits of any script, for pwc_tars prompts. */
const sanitizeCommand = (value: string, allowUnicode: boolean): string => {
  const hyphenated = value.toLowerCase().replace(/\s/g, '-');
  return allowUnicode
    ? hyphenated.replace(/[^\p{L}\p{M}\p{N}-]/gu, '')
    : hyphenated.replace(/[^a-z0-9-]/g, '');
};

const Command = ({
  initialValue,
  onValueChange,
  disabled,
  tabIndex,
  labelBgClassName = 'bg-surface-primary-alt',
  allowUnicode = false,
}: {
  initialValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  tabIndex?: number;
  /** Surface the floating label notches out of; must match whatever sits behind the field */
  labelBgClassName?: string;
  allowUnicode?: boolean;
}) => {
  const localize = useLocalize();
  const commandId = useId();
  const isComposing = useRef(false);
  const [command, setCommand] = useState(initialValue || '');
  /** IME text still being composed; sanitizing it mid-composition would wipe the candidate */
  const [draft, setDraft] = useState<string | null>(null);
  const [charCount, setCharCount] = useState(initialValue?.length || 0);

  useEffect(() => {
    setCommand(initialValue || '');
    setCharCount(initialValue?.length || 0);
  }, [initialValue]);

  useEffect(() => {
    setCharCount(command.length);
  }, [command]);

  const commitValue = (rawValue: string) => {
    const newValue = sanitizeCommand(rawValue, allowUnicode);

    if (newValue.length <= Constants.COMMANDS_MAX_LENGTH) {
      setCommand(newValue);
      onValueChange?.(newValue);
    }
  };

  const handleInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (isComposing.current) {
      setDraft(e.target.value);
      return;
    }
    commitValue(e.target.value);
  };

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd: React.CompositionEventHandler<HTMLInputElement> = (e) => {
    isComposing.current = false;
    setDraft(null);
    commitValue(e.currentTarget.value);
  };

  if (disabled === true && !command) {
    return null;
  }

  return (
    <div className="border-border-inset-medium rounded-xl border">
      <label htmlFor={commandId} className="text-text-secondary block px-4 pt-2 text-sm md:hidden">
        {localize('com_ui_command_placeholder')}
      </label>
      <div className="text-text-secondary relative flex h-10 items-center gap-1 ps-4 pe-2 text-sm">
        <SquareSlash className="icon-sm shrink-0" aria-hidden="true" />
        {/* The wrapper reserves the counter's side so it follows the inline end; <Input> owns its own padding. */}
        <div className="relative min-w-0 flex-1 pe-11">
          <Input
            type="text"
            id={commandId}
            tabIndex={tabIndex}
            disabled={disabled}
            placeholder=" "
            value={draft ?? command}
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            className="peer w-full border-none"
            aria-label={localize('com_ui_command_placeholder')}
          />
          <label
            htmlFor={commandId}
            className={cn(
              'text-text-secondary peer-focus:text-text-primary pointer-events-none absolute inset-s-0 top-0.5 hidden max-w-[calc(100%-3.5rem)] origin-[0] translate-y-2 scale-100 rounded px-1 text-sm transition-transform duration-200 peer-placeholder-shown:translate-y-2 peer-placeholder-shown:scale-100 peer-focus:-translate-y-3 peer-focus:scale-75 peer-[:not(:placeholder-shown)]:-translate-y-3 peer-[:not(:placeholder-shown)]:scale-75 md:block rtl:origin-right',
              labelBgClassName,
            )}
          >
            {localize('com_ui_command_placeholder')}
          </label>
        </div>
        {disabled !== true && (
          <span className="text-text-secondary absolute inset-e-2 shrink-0 text-xs md:text-sm">{`${charCount}/${Constants.COMMANDS_MAX_LENGTH}`}</span>
        )}
      </div>
    </div>
  );
};

export default Command;
