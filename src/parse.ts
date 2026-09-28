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

type OriginInput = { projectId?: string; filename?: string; error?: string };
type ProxyInput = { proxyPrefix?: string; filename?: string; error?: string };

/** The origin box takes a `www.datocms-assets.com` URL, or just a project ID. */
const parseOriginInput = (raw: string): OriginInput => {
  const text = splitQuery(raw).base;
  if (!text) return {};
  if (/^\d+$/.test(text)) return { projectId: text };
  const parsed = parseUrlInput(text);
  if (!parsed || parsed.proxyPrefix !== undefined) {
    return { error: 'Paste a www.datocms-assets.com URL, or just the project ID.' };
  }
  if (!/^\d+$/.test(parsed.projectId ?? '')) {
    return { error: 'Expected www.datocms-assets.com/<project ID>/<filename>.' };
  }
  return { projectId: parsed.projectId, filename: parsed.filename || undefined };
};

/** The proxy box takes the customer's URL, with or without the filename. */
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
  // A last segment with an extension that isn't a Dato filename would otherwise become a folder.
  if (!parsed.filename && /\/[^/]+\.[a-z0-9]{2,5}\/$/i.test(parsed.proxyPrefix)) {
    return { error: INVALID_FILENAME_MESSAGE };
  }
  return { proxyPrefix: parsed.proxyPrefix, filename: parsed.filename };
};

export type Endpoints = {
  projectId: string;
  filename: string;
  proxyPrefix: string;
  /** The filename each box contained itself; `filename` takes the origin's when both do. */
  originFilename?: string;
  proxyFilename?: string;
  originError?: string;
  proxyError?: string;
  isComplete: boolean;
};

/** Combines both boxes into the values a run needs, with a per-box error when they disagree. */
export const resolveEndpoints = (originRaw: string, proxyRaw: string): Endpoints => {
  const origin = parseOriginInput(originRaw);
  const proxy = parseProxyInput(proxyRaw);
  const filename = origin.filename ?? proxy.filename ?? '';

  let { error: originError } = origin;
  let { error: proxyError } = proxy;
  if (origin.filename && proxy.filename && origin.filename !== proxy.filename) {
    proxyError ??= `Filename differs from the origin's (${origin.filename}).`;
  }
  if (filename && !isDatoImageFilename(filename)) {
    if (origin.filename) originError ??= INVALID_FILENAME_MESSAGE;
    else proxyError ??= INVALID_FILENAME_MESSAGE;
  }

  const projectId = origin.projectId ?? '';
  const proxyPrefix = proxy.proxyPrefix ?? '';
  return {
    projectId,
    filename,
    proxyPrefix,
    originFilename: origin.filename,
    proxyFilename: proxy.filename,
    originError,
    proxyError,
    isComplete: Boolean(projectId && filename && proxyPrefix && !originError && !proxyError),
  };
};
