import { analyzeBody, emptyStats, isPreviewable, type ProbeResult } from './analyze.js';
import { INVALID_FILENAME_MESSAGE, isDatoImageUrl } from './filename.js';

/** Base64 inflates by a third; this keeps the JSON under Vercel's 4.5 MB response limit. */
const MAX_PREVIEW_BYTES = 2_500_000;
const UPSTREAM_TIMEOUT_MS = 20_000;

const NO_STORE = {
  'cache-control': 'no-store',
  'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store',
};

/**
 * Only public https hosts. Blocks IP literals and local names so the endpoint can't reach
 * internal networks, and returns JSON metadata rather than raw bodies so it's a poor open proxy.
 */
const isPublicHttps = ({ protocol, hostname }: URL) =>
  protocol === 'https:' &&
  hostname.includes('.') &&
  !/^[\d.]+$|^\[|:/.test(hostname) &&
  !/\.(local|internal|localhost)$/.test(hostname);

/** Returns why `raw` can't be inspected, or null when it can. Runs before any upstream fetch. */
const rejectTarget = (raw: string) => {
  try {
    const url = new URL(raw);
    if (!isPublicHttps(url)) return 'url must be a public https URL';
    return isDatoImageUrl(url) ? null : INVALID_FILENAME_MESSAGE;
  } catch {
    return 'url is malformed';
  }
};

/** Fetches `url` server-side with the given `Accept` and no caching, and describes the response. */
export const inspect = async (url: string, accept: string): Promise<ProbeResult> => {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: { accept },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const ms = Math.round(performance.now() - startedAt);
    const stats = await analyzeBody(body);
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const hasPreview = isPreviewable(stats.format) && body.byteLength <= MAX_PREVIEW_BYTES;
    return {
      ...stats,
      url,
      finalUrl: response.url,
      status: response.status,
      ms,
      headers: Object.fromEntries(response.headers),
      previewUrl: hasPreview
        ? `data:${contentType};base64,${Buffer.from(body).toString('base64')}`
        : null,
    };
  } catch (error) {
    return {
      ...emptyStats,
      url,
      finalUrl: url,
      status: 0,
      error: `Server fetch failed: ${(error as Error).message}`,
      ms: Math.round(performance.now() - startedAt),
      headers: {},
      previewUrl: null,
    };
  }
};

/** `GET /api/inspect?url=…&accept=…`, or `?ping=1` to detect the server and its region. */
export const handleInspectRequest = async (request: Request) => {
  const params = new URL(request.url).searchParams;

  if (params.has('ping')) {
    return Response.json(
      { ok: true, region: process.env.VERCEL_REGION ?? 'local' },
      { headers: NO_STORE },
    );
  }

  const url = params.get('url') ?? '';
  const rejection = rejectTarget(url);
  if (rejection) {
    return Response.json({ error: rejection }, { status: 400, headers: NO_STORE });
  }

  return Response.json(await inspect(url, params.get('accept') ?? '*/*'), { headers: NO_STORE });
};
