import { INVALID_FILENAME_MESSAGE, isDatoImageFilename } from '../lib/filename.js';

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

/** Splits `?query` off a pasted URL, so it can go into the param grid instead of the box. */
export const splitQuery = (raw: string) => {
  const index = raw.indexOf('?');
  return index === -1
    ? { base: raw.trim(), query: '' }
    : { base: raw.slice(0, index).trim(), query: raw.slice(index + 1).trim() };
};

type ParsedBox = { filename?: string; error?: string };
type OriginInput = ParsedBox & { projectId?: string };
type ProxyInput = ParsedBox & { proxyPrefix?: string };

const MISSING_FILENAME = 'Paste the full image URL, including the filename.';

/** The origin box takes a full `www.datocms-assets.com/<project>/<file>` URL. */
const parseOriginInput = (raw: string): OriginInput => {
  const text = splitQuery(raw).base;
  if (!text) return {};
  const parsed = parseUrlInput(text);
  if (!parsed || parsed.proxyPrefix !== undefined) {
    return { error: 'Paste a www.datocms-assets.com image URL.' };
  }
  if (!/^\d+$/.test(parsed.projectId ?? '')) {
    return { error: 'Expected www.datocms-assets.com/<project ID>/<filename>.' };
  }
  if (!parsed.filename) return { projectId: parsed.projectId, error: MISSING_FILENAME };
  if (!isDatoImageFilename(parsed.filename)) {
    return {
      projectId: parsed.projectId,
      filename: parsed.filename,
      error: INVALID_FILENAME_MESSAGE,
    };
  }
  return { projectId: parsed.projectId, filename: parsed.filename };
};

/** The proxy box takes the same image's full URL on the customer's domain. */
const parseProxyInput = (raw: string): ProxyInput => {
  const text = splitQuery(raw).base;
  if (!text) return {};
  const parsed = parseUrlInput(text);
  if (!parsed) return { error: 'Not a URL.' };
  if (parsed.proxyPrefix === undefined) {
    return {
      error: "That's the DatoCMS URL, which goes in the origin box. Paste the customer's URL here.",
    };
  }
  if (!parsed.filename) {
    // A last segment with an extension means a filename that isn't a DatoCMS upload name.
    const hasExtension = /\/[^/]+\.[a-z0-9]{2,5}\/$/i.test(parsed.proxyPrefix);
    return { error: hasExtension ? INVALID_FILENAME_MESSAGE : MISSING_FILENAME };
  }
  return { proxyPrefix: parsed.proxyPrefix, filename: parsed.filename };
};

export type Endpoints = {
  projectId: string;
  proxyPrefix: string;
  /** Shared by both URLs once they agree. */
  filename: string;
  originFilename?: string;
  proxyFilename?: string;
  originError?: string;
  proxyError?: string;
  isComplete: boolean;
};

/**
 * Combines both boxes into the values a run needs. Both must be full URLs with the same
 * filename: that's the only way to be sure both sides serve the same image.
 */
export const resolveEndpoints = (originRaw: string, proxyRaw: string): Endpoints => {
  const origin = parseOriginInput(originRaw);
  const proxy = parseProxyInput(proxyRaw);
  let proxyError = proxy.error;
  if (!origin.error && origin.filename && proxy.filename && origin.filename !== proxy.filename) {
    proxyError ??= `Filename differs from the origin's (${origin.filename}).`;
  }
  const isComplete = Boolean(
    origin.projectId && origin.filename && proxy.proxyPrefix && !origin.error && !proxyError,
  );
  return {
    projectId: origin.projectId ?? '',
    proxyPrefix: proxy.proxyPrefix ?? '',
    filename: isComplete ? (origin.filename as string) : '',
    originFilename: origin.filename,
    proxyFilename: proxy.filename,
    originError: origin.error,
    proxyError,
    isComplete,
  };
};
