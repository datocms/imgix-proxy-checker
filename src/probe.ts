import {
  analyzeBody,
  emptyStats,
  isPreviewable,
  type ProbeResult,
  type ProbeVia,
} from '../lib/analyze.js';

export type ServerInfo = { isAvailable: boolean; region: string | null };

let serverCheck: Promise<ServerInfo> | undefined;

/** Detects the `/api/inspect` function (absent on a plain static host). */
export const detectServer = () => {
  serverCheck ??= fetch('/api/inspect?ping=1', { cache: 'no-store' })
    .then(async (response) => {
      const { region } = (await response.json()) as { region: string };
      return { isAvailable: response.ok, region };
    })
    .catch(() => ({ isAvailable: false, region: null }));
  return serverCheck;
};

const failure = (url: string, via: ProbeVia, error: string, ms: number): ProbeResult => ({
  ...emptyStats,
  url,
  finalUrl: url,
  status: 0,
  error,
  ms,
  headers: {},
  via,
  previewUrl: null,
});

/**
 * Fetches straight from the viewer's browser, bypassing the HTTP cache. Cross-origin, the
 * browser only exposes CORS-safelisted headers, so CDN cache headers stay invisible.
 */
const probeFromBrowser = async (url: string, accept: string): Promise<ProbeResult> => {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { headers: { Accept: accept }, cache: 'no-store' });
    const body = new Uint8Array(await response.arrayBuffer());
    const ms = Math.round(performance.now() - startedAt);
    const stats = await analyzeBody(body);
    const contentType = response.headers.get('content-type') ?? undefined;
    return {
      ...stats,
      url,
      finalUrl: response.url,
      status: response.status,
      ms,
      headers: Object.fromEntries(response.headers),
      via: 'browser',
      previewUrl: isPreviewable(stats.format)
        ? URL.createObjectURL(new Blob([body], { type: contentType }))
        : null,
    };
  } catch (error) {
    return failure(
      url,
      'browser',
      `Request failed (network or CORS): ${(error as Error).message}`,
      Math.round(performance.now() - startedAt),
    );
  }
};

/** Asks the checker's server function to fetch the URL, which exposes every response header. */
const probeFromServer = async (url: string, accept: string): Promise<ProbeResult> => {
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `/api/inspect?url=${encodeURIComponent(url)}&accept=${encodeURIComponent(accept)}`,
      { cache: 'no-store' },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload as ProbeResult;
  } catch (error) {
    return failure(
      url,
      'server',
      (error as Error).message,
      Math.round(performance.now() - startedAt),
    );
  }
};

export const probe = (url: string, accept: string, via: ProbeVia) =>
  via === 'server' ? probeFromServer(url, accept) : probeFromBrowser(url, accept);
