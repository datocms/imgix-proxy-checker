import type { ProbeResult } from '../lib/analyze.js';
import type { TestCase } from './tests';

export type Level = 'pass' | 'warn' | 'fail';

export type Verdict = { level: Level; notes: string[] };

/** Headers the proxy must relay unchanged. `true` means a mismatch fails, `false` warns. */
const RELAYED_HEADERS: Record<string, boolean> = {
  'content-disposition': true,
  'cache-control': false,
  'access-control-allow-origin': false,
  'timing-allow-origin': false,
};

/** Longest shared-cache lifetime that still lets DatoCMS replacements show up within a day. */
export const MAX_PROXY_TTL_SECONDS = 86_400;

const DAY_SECONDS = 86_400;

const formatDuration = (seconds: number) =>
  seconds >= DAY_SECONDS
    ? `${Math.round(seconds / DAY_SECONDS)} days`
    : `${Math.round(seconds / 3600)} hours`;

/** Shared-cache TTL a response allows: CDN-specific headers first, then s-maxage, then max-age. */
const sharedTtl = (headers: Record<string, string>) => {
  for (const name of ['cdn-cache-control', 'surrogate-control', 'cache-control']) {
    const value = headers[name];
    if (!value) continue;
    const match =
      /(?:^|[,\s])s-maxage=(\d+)/i.exec(value) ?? /(?:^|[,\s])max-age=(\d+)/i.exec(value);
    if (match) return { seconds: Number(match[1]), header: name };
  }
  return null;
};

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const RANK: Record<Level, number> = { pass: 0, warn: 1, fail: 2 };

/** Judges the proxied response against the origin response for one test case. */
export const compare = (test: TestCase, original: ProbeResult, proxied: ProbeResult): Verdict => {
  let level: Level = 'pass';
  const notes: string[] = [];
  const flag = (next: Level, note: string) => {
    if (RANK[next] > RANK[level]) level = next;
    notes.push(note);
  };

  if (original.error || proxied.error) {
    if (original.error) flag('fail', `Origin: ${original.error}`);
    if (proxied.error) flag('fail', `Proxy: ${proxied.error}`);
    return { level, notes };
  }

  if (proxied.finalUrl !== proxied.url) {
    flag('warn', `Proxy redirected to ${proxied.finalUrl}: every image pays an extra round trip.`);
  }

  if (original.status !== proxied.status) {
    flag('fail', `Status differs: origin ${original.status}, proxy ${proxied.status}.`);
  } else if (original.status !== 200) {
    flag('warn', `Both returned ${original.status}.`);
  }

  if (test.expect) {
    if (!test.expect.formats.includes(proxied.format)) {
      flag(
        'fail',
        `Proxy served ${proxied.format}, expected ${test.expect.formats.join('/')}. ${test.expect.hint}`,
      );
    }
    if (!test.expect.formats.includes(original.format)) {
      flag('warn', `Origin also served ${original.format}: this row can't judge the proxy.`);
    }
  }

  if (original.format !== proxied.format) {
    flag('fail', `Format differs: origin ${original.format}, proxy ${proxied.format}.`);
  }

  if (original.width !== proxied.width || original.height !== proxied.height) {
    flag(
      'fail',
      `Dimensions differ: origin ${original.width}×${original.height}, proxy ${proxied.width}×${proxied.height}.`,
    );
  }

  if (original.sha256 === proxied.sha256) {
    notes.push('Byte-identical.');
  } else if (level === 'pass') {
    const delta = ((proxied.bytes - original.bytes) / original.bytes) * 100;
    flag(
      'warn',
      `Same format and size, different bytes (${formatBytes(original.bytes)} → ${formatBytes(proxied.bytes)}, ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%). A param may not reach imgix.`,
    );
  }

  if (test.expectHeader) {
    const { name, value, hint } = test.expectHeader;
    const actual = proxied.headers[name];
    if (actual !== value) {
      flag('fail', `${name}: expected "${value}", proxy sent "${actual ?? '(missing)'}". ${hint}`);
    }
  }

  for (const [name, isRequired] of Object.entries(RELAYED_HEADERS)) {
    const expected = original.headers[name];
    if (!expected || name === test.expectHeader?.name) continue;
    // With an Origin header, the origin echoes it; a proxy answering "*" is equally valid.
    if (name === 'access-control-allow-origin' && test.variant === 'origin') continue;
    const actual = proxied.headers[name];
    if (name === 'access-control-allow-origin' && actual && actual !== '*' && expected === '*') {
      flag(
        'warn',
        `Proxy sent access-control-allow-origin "${actual}" to a request without an Origin header. Its cache key ignores Origin, so it serves a CORS header cached for another site. Have the proxy always send "*", or add Origin to its cache key.`,
      );
      continue;
    }
    if (actual !== expected) {
      flag(
        isRequired ? 'fail' : 'warn',
        `${name}: origin "${expected}", proxy "${actual ?? '(missing)'}".`,
      );
    }
  }

  if (test.checkTtl) {
    const ttl = sharedTtl(proxied.headers);
    const age = Number(proxied.headers.age ?? 0);
    if (ttl && ttl.seconds > MAX_PROXY_TTL_SECONDS) {
      flag(
        'warn',
        `The proxy's ${ttl.header} lets shared caches keep images for ${formatDuration(ttl.seconds)}${age > MAX_PROXY_TTL_SECONDS ? `, and this copy is already ${formatDuration(age)} old` : ''}. DatoCMS purges its own CDN when an editor replaces an image in place, deletes it, or quarantines it. Those purges don't reach the proxy, so it keeps serving the old file. Cap the proxy's TTL at 1 day, or invalidate it from a DatoCMS upload webhook. A CDN max-TTL setting can override this header.`,
      );
    } else if (ttl) {
      notes.push(`Proxy cache lifetime: ${formatDuration(ttl.seconds)}.`);
    }
  }

  if (level !== 'pass' && test.failureHint) notes.push(test.failureHint);
  if (test.maxLevel && RANK[level] > RANK[test.maxLevel]) level = test.maxLevel;
  return { level, notes };
};
