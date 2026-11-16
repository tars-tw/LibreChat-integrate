import type { Endpoint } from '~/common';

type EndpointModels = NonNullable<Endpoint['models']>;

/**
 * The display names an admin gave these models in pwc_tars 模型管理, keyed by the name
 * the endpoint lists them under. `labels` is keyed by lower-cased model name, which is
 * how the whitelist matches too. Undefined when none of the models has one.
 */
export const pickModelNames = (
  models: EndpointModels,
  labels: Map<string, string> | null | undefined,
): Record<string, string> | undefined => {
  if (!labels?.size) {
    return undefined;
  }
  /** No prototype, so a model named `constructor` or `toString` cannot read an inherited method. */
  const names: Record<string, string> = Object.create(null);
  let found = false;
  for (const { name } of models) {
    const label = labels.get(name.toLowerCase());
    if (label) {
      names[name] = label;
      found = true;
    }
  }
  return found ? names : undefined;
};

/** Whether a search term matches the display name a model was given, if it has one. */
export const matchesModelName = (
  endpoint: Pick<Endpoint, 'modelNames'>,
  model: string,
  lowerQuery: string,
): boolean => endpoint.modelNames?.[model]?.toLowerCase().includes(lowerQuery) ?? false;
