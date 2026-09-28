import { emptyStats, type ProbeResult } from '../lib/analyze.js';
import type { RequestVariant } from '../lib/variants.js';

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

/** Asks the checker's server function to fetch `url` with the given `Accept` and variant. */
export const probe = async (
  url: string,
  accept: string,
  variant?: RequestVariant,
): Promise<ProbeResult> => {
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `/api/inspect?url=${encodeURIComponent(url)}&accept=${encodeURIComponent(accept)}${
        variant ? `&variant=${variant}` : ''
      }`,
      { cache: 'no-store' },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload as ProbeResult;
  } catch (error) {
    return {
      ...emptyStats,
      url,
      finalUrl: url,
      status: 0,
      error: (error as Error).message,
      ms: Math.round(performance.now() - startedAt),
      headers: {},
      previewUrl: null,
    };
  }
};
