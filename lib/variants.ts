/**
 * Extra request headers the cache-key tests send. The checker picks every value; callers only
 * name a variant, so `/api/inspect` can't send arbitrary headers to a customer's proxy.
 */
export const REQUEST_VARIANTS = {
  /** `.invalid` is a reserved TLD, so this origin can never belong to a real site. */
  origin: { header: 'origin', value: 'https://imgix-proxy-checker.invalid' },
} as const;

export type RequestVariant = keyof typeof REQUEST_VARIANTS;

export const isRequestVariant = (value: string | null): value is RequestVariant =>
  value !== null && Object.hasOwn(REQUEST_VARIANTS, value);
