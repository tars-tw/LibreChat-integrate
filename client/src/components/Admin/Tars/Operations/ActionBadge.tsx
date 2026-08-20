import { actionConfig, FALLBACK_ACTION, toneClasses } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * One action verb as an icon plus its name. A verb pwc_tars adds later has no
 * entry here, so it falls back to a neutral badge showing its raw name.
 */
export default function ActionBadge({ action }: { action: string | null | undefined }) {
  const localize = useLocalize();
  const config = actionConfig(action);
  const Icon = config?.icon ?? FALLBACK_ACTION.icon;
  const tone = config?.tone ?? FALLBACK_ACTION.tone;
  const label = config != null ? localize(config.labelKey) : (action ?? '—');

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(tone)}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
