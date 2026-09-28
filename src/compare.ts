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

  for (const [name, isRequired] of Object.entries(RELAYED_HEADERS)) {
    const expected = original.headers[name];
    if (!expected) continue;
    const actual = proxied.headers[name];
    if (name === 'access-control-allow-origin' && actual && actual !== '*' && expected === '*') {
      flag(
        'warn',
        `Proxy sent access-control-allow-origin "${actual}" to a request without an Origin header. Its cache key ignores Origin, so it serves a CORS header cached for another site. Add Origin to the proxy's cache key.`,
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

  return { level, notes };
};
