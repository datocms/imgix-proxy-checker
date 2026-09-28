import { isDatoImageFilename } from '../lib/filename.js';

export type UrlFields = {
  projectId?: string;
  filename?: string;
  proxyPrefix?: string;
  /** Query string, without the leading `?`. */
  query?: string;
};

const safeDecode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Adds a missing scheme and upgrades `http`: the checker only fetches https. */
const toHttpsUrl = (raw: string) =>
  new URL(`https://${raw.trim().replace(/^(https?:)?\/\//i, '')}`);

/**
 * Splits whatever the user typed or pasted into settings fields.
 *
 * - An origin URL (`www.datocms-assets.com/<project>/<file>`) yields project, filename and params.
 * - Any other URL yields the proxy prefix. When it ends in a DatoCMS image filename, that
 *   segment becomes the filename instead of part of the prefix.
 * - A query string becomes the user's query params.
 *
 * Returns null when the input isn't a usable URL.
 */
export const parseUrlInput = (raw: string): UrlFields | null => {
  if (!raw.trim()) return null;
  let url: URL;
  try {
    url = toHttpsUrl(raw);
  } catch {
    return null;
  }
  if (!url.hostname.includes('.')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const extra = url.search ? { query: url.search.slice(1) } : {};

  if (url.hostname.endsWith('datocms-assets.com')) {
    return {
      projectId: segments[0] ?? '',
      filename: safeDecode(segments.slice(1).join('/')),
      ...extra,
    };
  }

  const lastSegment = safeDecode(segments.at(-1) ?? '');
  const hasFilename = isDatoImageFilename(lastSegment);
  const directories = hasFilename ? segments.slice(0, -1) : segments;
  return {
    proxyPrefix: `${url.origin}/${directories.map((segment) => `${segment}/`).join('')}`,
    ...(hasFilename ? { filename: lastSegment } : {}),
    ...extra,
  };
};
