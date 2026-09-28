import { Fragment, useEffect, useRef, useState } from 'react';
import { compare, formatBytes, type Level, type Verdict } from './compare';
import type { ProbeResult, ProbeVia } from '../lib/analyze.js';
import { INVALID_FILENAME_MESSAGE, isDatoImageFilename } from '../lib/filename.js';
import { detectServer, probe, type ServerInfo } from './probe';
import { buildTestCases, type TestCase, type TestGroup } from './tests';

const ORIGIN_HOST = 'https://www.datocms-assets.com';
const PARALLEL_REQUESTS = 4;
const CACHE_HEADERS = ['cf-cache-status', 'x-cache', 'age', 'cache-control', 'vary'];

type Settings = {
  projectId: string;
  filename: string;
  proxyPrefix: string;
  extraParams: string;
  customQueries: string;
  mode: ProbeVia;
};

type Row = {
  test: TestCase;
  original?: ProbeResult;
  proxied?: ProbeResult;
  verdict?: Verdict;
};

const SETTING_KEYS: (keyof Settings)[] = [
  'projectId',
  'filename',
  'proxyPrefix',
  'extraParams',
  'customQueries',
  'mode',
];

const GROUP_TITLES: Record<TestGroup, string> = {
  negotiation: 'Format negotiation (auto=format) · simulated browser Accept headers',
  params: 'Common imgix params',
  custom: 'Custom queries',
};

/** All state lives in the query string, so a link reproduces a run and nothing is stored. */
const readSettings = (): Settings => {
  const params = new URLSearchParams(window.location.search);
  const settings = Object.fromEntries(
    SETTING_KEYS.map((key) => [key, params.get(key) ?? '']),
  ) as Settings;
  return { ...settings, mode: settings.mode === 'browser' ? 'browser' : 'server' };
};

const shareUrl = (settings: Settings) => {
  const params = new URLSearchParams();
  for (const key of SETTING_KEYS) if (settings[key]) params.set(key, settings[key]);
  return `${window.location.origin}${window.location.pathname}?${params}`;
};

const hasSharedSettings = (settings: Settings) =>
  Boolean(
    /^\d+$/.test(settings.projectId) &&
    isDatoImageFilename(settings.filename) &&
    settings.proxyPrefix,
  );

const withQuery = (base: string, query: string) => (query ? `${base}?${query}` : base);

/**
 * Fills settings from a pasted URL. An origin URL yields project, filename and params;
 * any other URL yields the proxy prefix and filename.
 */
const parsePastedUrl = (raw: string): Partial<Settings> => {
  const url = new URL(raw.trim());
  const segments = url.pathname.split('/').filter(Boolean);
  const extraParams = url.search.slice(1);
  if (url.hostname.endsWith('datocms-assets.com')) {
    return {
      projectId: segments[0] ?? '',
      filename: segments.slice(1).join('/'),
      extraParams,
    };
  }
  const filename = segments.at(-1) ?? '';
  return {
    proxyPrefix: `${url.origin}/${segments.slice(0, -1).join('/')}/`.replace(/\/+$/, '/'),
    filename,
    extraParams,
  };
};

/** Runs `tasks` with at most `limit` in flight. */
const runPool = async (tasks: (() => Promise<void>)[], limit: number) => {
  const queue = [...tasks];
  const worker = async () => {
    for (let task = queue.shift(); task; task = queue.shift()) await task();
  };
  await Promise.all(Array.from({ length: limit }, worker));
};

const describe = (result?: ProbeResult) => {
  if (!result) return '…';
  if (result.error) return 'error';
  const size = result.width ? `${result.width}×${result.height}` : '—';
  return `${result.format} · ${size} · ${formatBytes(result.bytes)}`;
};

const cacheSummary = (result?: ProbeResult) => {
  if (result?.via !== 'server') return result?.headers['cache-control'] ?? '';
  return ['cf-cache-status', 'x-cache', 'age']
    .filter((name) => result.headers[name])
    .map((name) => `${name}: ${result.headers[name]}`)
    .join(' · ');
};

const Badge = ({ level }: { level?: Level }) => (
  <span className={`badge badge-${level ?? 'pending'}`}>{level ?? 'running'}</span>
);

const Side = ({ title, result }: { title: string; result?: ProbeResult }) => (
  <div className="side">
    <h4>{title}</h4>
    {result?.previewUrl ? (
      <img src={result.previewUrl} alt={title} />
    ) : (
      <div className="noimg">No image</div>
    )}
    <a href={result?.url} target="_blank" rel="noreferrer" className="url">
      {result?.url}
    </a>
    {result && (
      <table className="headers">
        <tbody>
          <tr>
            <th>status</th>
            <td>{result.status}</td>
          </tr>
          <tr>
            <th>sha256</th>
            <td>{result.sha256.slice(0, 16)}</td>
          </tr>
          <tr>
            <th>time</th>
            <td>
              {result.ms} ms (from {result.via})
            </td>
          </tr>
          {result.finalUrl !== result.url && (
            <tr>
              <th>redirected to</th>
              <td>{result.finalUrl}</td>
            </tr>
          )}
          {Object.entries(result.headers)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => (
              <tr key={name} className={CACHE_HEADERS.includes(name) ? 'hl' : undefined}>
                <th>{name}</th>
                <td>{value}</td>
              </tr>
            ))}
        </tbody>
      </table>
    )}
  </div>
);

export const App = () => {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const blobUrls = useRef<string[]>([]);
  const hasAutoRun = useRef(false);

  const update = (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch }));

  const applyPasted = (raw: string) => {
    setPasted(raw);
    try {
      update(parsePastedUrl(raw));
    } catch {
      // Not a full URL yet; wait for more input.
    }
  };

  const isReady = hasSharedSettings(settings);
  const via: ProbeVia = settings.mode === 'server' && server?.isAvailable ? 'server' : 'browser';

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareUrl(settings));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  const run = async (via: ProbeVia) => {
    window.history.replaceState(null, '', shareUrl(settings));
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
    blobUrls.current = [];
    setExpanded(null);
    setIsRunning(true);

    const originBase = `${ORIGIN_HOST}/${settings.projectId}/${settings.filename}`;
    const proxyBase = `${settings.proxyPrefix.replace(/\/?$/, '/')}${settings.filename}`;
    const customQueries = settings.customQueries
      .split('\n')
      .map((line) => line.trim().replace(/^\?/, ''))
      .filter(Boolean);
    const tests = buildTestCases(settings.extraParams.replace(/^\?/, ''), customQueries);
    setRows(tests.map((test) => ({ test })));

    const execute = async (test: TestCase) => {
      const [original, proxied] = await Promise.all([
        probe(withQuery(originBase, test.query), test.accept, via),
        probe(withQuery(proxyBase, test.query), test.accept, via),
      ]);
      for (const { previewUrl } of [original, proxied])
        if (previewUrl?.startsWith('blob:')) blobUrls.current.push(previewUrl);
      const verdict = compare(test, original, proxied);
      setRows((current) =>
        current.map((row) =>
          row.test.id === test.id ? { test, original, proxied, verdict } : row,
        ),
      );
    };

    // Negotiation rows share one URL and must run in order to expose a poisoned cache.
    for (const test of tests.filter((test) => test.group === 'negotiation')) await execute(test);
    await runPool(
      tests.filter((test) => test.group !== 'negotiation').map((test) => () => execute(test)),
      PARALLEL_REQUESTS,
    );
    setIsRunning(false);
  };

  // A shared link runs as soon as the server check settles.
  useEffect(() => {
    detectServer().then((info) => {
      setServer(info);
      if (hasAutoRun.current || !hasSharedSettings(settings)) return;
      hasAutoRun.current = true;
      run(settings.mode === 'server' && info.isAvailable ? 'server' : 'browser');
    });
  }, []);

  const counts = rows.reduce(
    (acc, row) => (row.verdict ? { ...acc, [row.verdict.level]: acc[row.verdict.level] + 1 } : acc),
    { pass: 0, warn: 0, fail: 0 },
  );

  const groups = (['negotiation', 'params', 'custom'] as TestGroup[])
    .map((group) => ({ group, rows: rows.filter((row) => row.test.group === group) }))
    .filter(({ rows }) => rows.length > 0);

  return (
    <main>
      <header>
        <h1>Imgix Proxy Checker</h1>
        <p>
          Compares a reverse-proxied DatoCMS asset with the same asset on{' '}
          <code>www.datocms-assets.com</code>, across common imgix params and{' '}
          <code>auto=format</code> negotiation. Nothing is cached or stored: every request goes
          straight to both hosts, and all settings live in this page's URL.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(via);
        }}
      >
        <label className="wide">
          Paste a URL (origin or proxied) to fill the fields
          <input
            value={pasted}
            onChange={(event) => applyPasted(event.target.value)}
            placeholder="https://www.datocms-assets.com/12345/1700000000-photo.png?w=800"
          />
        </label>
        <label>
          Project ID
          <input
            value={settings.projectId}
            onChange={(event) => update({ projectId: event.target.value.trim() })}
            placeholder="12345"
            required
          />
          {settings.projectId && !/^\d+$/.test(settings.projectId) && (
            <span className="warn-text">Project IDs are numeric.</span>
          )}
        </label>
        <label>
          Filename
          <input
            value={settings.filename}
            onChange={(event) => update({ filename: event.target.value.trim() })}
            placeholder="1700000000-photo.png"
            required
          />
          {settings.filename && !isDatoImageFilename(settings.filename) && (
            <span className="warn-text">{INVALID_FILENAME_MESSAGE}</span>
          )}
        </label>
        <label className="wide">
          <span>
            Proxy prefix (replaces <code>{ORIGIN_HOST}/&lt;project&gt;/</code>)
          </span>
          <input
            value={settings.proxyPrefix}
            onChange={(event) => update({ proxyPrefix: event.target.value.trim() })}
            placeholder="https://example.com/assets/"
            required
          />
        </label>
        <label className="wide">
          Extra params added to every test (tests override clashes)
          <input
            value={settings.extraParams}
            onChange={(event) => update({ extraParams: event.target.value.trim() })}
            placeholder="auto=compress&q=90"
          />
        </label>
        <label className="wide">
          Custom queries, one per line (sent with a simulated AVIF-capable Accept)
          <textarea
            value={settings.customQueries}
            onChange={(event) => update({ customQueries: event.target.value })}
            placeholder="w=1440&fm=webp&q=90"
            rows={2}
          />
        </label>
        <fieldset className="wide mode">
          <legend>Fetch from</legend>
          <label className="radio">
            <input
              type="radio"
              checked={settings.mode === 'server'}
              disabled={server?.isAvailable === false}
              onChange={() => update({ mode: 'server' })}
            />
            Checker server{server?.region ? ` (${server.region})` : ''}: shows every header,
            including CDN cache status
          </label>
          <label className="radio">
            <input
              type="radio"
              checked={settings.mode === 'browser'}
              onChange={() => update({ mode: 'browser' })}
            />
            This browser: hits your nearest CDN edge, but can only read Content-Type and
            Cache-Control
          </label>
          {server?.isAvailable === false && (
            <p className="warn-text">
              Server function unreachable here, so requests go from the browser.
            </p>
          )}
        </fieldset>
        <p className="wide sim-note">
          <strong>Simulation:</strong> both modes set the <code>Accept</code> header by hand to
          imitate AVIF-capable, WebP-only and legacy clients. No real browser negotiation happens.
        </p>
        <div className="actions wide">
          <button type="submit" disabled={!isReady || isRunning}>
            {isRunning ? 'Running…' : 'Run checks'}
          </button>
          <button type="button" className="secondary" disabled={!isReady} onClick={copyShareLink}>
            {isCopied ? 'Copied' : 'Copy share link'}
          </button>
        </div>
      </form>

      {rows.length > 0 && (
        <section>
          <p className="summary">
            <Badge level="pass" /> {counts.pass} <Badge level="warn" /> {counts.warn}{' '}
            <Badge level="fail" /> {counts.fail}
            <span className="muted">
              {' '}
              · {rows.length} tests · click a row for previews and headers
            </span>
          </p>
          <div className="scroll">
            <table className="results">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Query</th>
                  <th>Accept (sim)</th>
                  <th>Origin</th>
                  <th>Proxy</th>
                  <th>{via === 'server' ? 'Proxy cache' : 'Proxy Cache-Control'}</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ group, rows }) => (
                  <Fragment key={group}>
                    <tr className="group">
                      <td colSpan={7}>{GROUP_TITLES[group]}</td>
                    </tr>
                    {rows.map(({ test, original, proxied, verdict }) => (
                      <Fragment key={test.id}>
                        <tr
                          className={`row row-${verdict?.level ?? 'pending'}`}
                          onClick={() => setExpanded(expanded === test.id ? null : test.id)}
                        >
                          <td>{test.label}</td>
                          <td>
                            <code>{test.query || '—'}</code>
                          </td>
                          <td>{test.acceptLabel}</td>
                          <td>{describe(original)}</td>
                          <td>{describe(proxied)}</td>
                          <td className="muted">{cacheSummary(proxied)}</td>
                          <td>
                            <Badge level={verdict?.level} />
                            {verdict?.notes.map((note) => (
                              <div key={note} className="note">
                                {note}
                              </div>
                            ))}
                          </td>
                        </tr>
                        {expanded === test.id && (
                          <tr className="detail">
                            <td colSpan={7}>
                              <div className="sides">
                                <Side title="Origin" result={original} />
                                <Side title="Proxy" result={proxied} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
};
