/** Reads of trace values that can hold anything pwc_tars wrote, each with a defined answer. */

/**
 * `map[key]` for a key read from a trace. Only the map's own entries count, so a
 * value such as `constructor` reads as unknown rather than as a member every
 * object inherits.
 */
export function ownValue<V>(
  map: Readonly<Record<string | number, V>>,
  key: string | number | null | undefined,
): V | undefined {
  if (key == null || !Object.prototype.hasOwnProperty.call(map, key)) {
    return undefined;
  }
  return map[key];
}

/** The strings of a list field; anything that is not a list reads as empty. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

/** A number with fixed decimals, or '—' when the value is not a finite number. */
export function fixedNumber(value: unknown, digits: number): string {
  const number = typeof value === 'number' ? value : Number(value);
  return value != null && value !== '' && Number.isFinite(number) ? number.toFixed(digits) : '—';
}
