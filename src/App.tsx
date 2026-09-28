import { type ClipboardEvent, Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPreviewable, type ProbeResult } from '../lib/analyze.js';
import { INVALID_FILENAME_MESSAGE, isDatoImageFilename } from '../lib/filename.js';
import { compare, formatBytes, type Level, type Verdict } from './compare';
import { newParam, ParamGrid, paramsFromQuery } from './ParamGrid';
import { parseUrlInput, type UrlFields } from './parse';
import { detectServer, probe, type ServerInfo } from './probe';
import {
  buildTestCases,
  type QueryParam,
  serializeParams,
  type TestCase,
  type TestGroup,
} from './tests';

const ORIGIN_HOST = 'https://www.datocms-assets.com';
const PARALLEL_REQUESTS = 4;
const CACHE_HEADERS = ['cf-cache-status', 'x-cache', 'age', 'cache-control', 'vary'];
const ZOOM_WIDTH = 372;
const ZOOM_HEIGHT = 420;
const ZOOM_GAP = 12;
/** Lets the pointer cross the gap between thumbnail and popup without closing it. */
const ZOOM_CLOSE_DELAY_MS = 150;
const URL_DISPLAY_LENGTH = 50;

type Settings = {
  projectId: string;
  filename: string;
  proxyPrefix: string;
  params: QueryParam[];
};

type Row = {
  test: TestCase;
  original?: ProbeResult;
  proxied?: ProbeResult;
  verdict?: Verdict;
};

const GROUP_TITLES: Record<TestGroup, string> = {
  negotiation: 'Format negotiation (auto=format) · simulated browser Accept headers',
  params: 'Common imgix params',
  custom: 'Your query · simulated browser Accept headers',
};

const hasParams = (params: QueryParam[]) => params.some(({ key }) => key.trim());

/** Turns parsed URL fields into a settings patch; a pasted query replaces the grid. */
const toSettingsPatch = ({ query, ...fields }: UrlFields): Partial<Settings> => ({
  ...fields,
  ...(query ? { params: paramsFromQuery(query) } : {}),
});

/** Cleans up a hand-typed proxy prefix: adds https://, splits off a pasted filename or query. */
const normalizeSettings = (settings: Settings): Settings => {
  const parsed = parseUrlInput(settings.proxyPrefix);
  if (!parsed?.proxyPrefix) return settings;
  return {
    ...settings,
    proxyPrefix: parsed.proxyPrefix,
    filename: settings.filename || parsed.filename || '',
    params:
      hasParams(settings.params) || !parsed.query ? settings.params : paramsFromQuery(parsed.query),
  };
};

/**
 * All state lives in the page's query string, so a link reproduces a run and nothing is stored.
 * Enabled params go in `query`, disabled ones in `off`. `extraParams` and `customQueries` are
 * read for links made before the param grid.
 */
const readSettings = (): Settings => {
  const search = new URLSearchParams(window.location.search);
  const query =
    search.get('query') ??
    search.get('extraParams') ??
    search.get('customQueries')?.split('\n')[0] ??
    '';
  const disabled = paramsFromQuery(search.get('off') ?? '').map((param) => ({
    ...param,
    isEnabled: false,
  }));
  return normalizeSettings({
    projectId: search.get('projectId') ?? '',
    filename: search.get('filename') ?? '',
    proxyPrefix: search.get('proxyPrefix') ?? '',
    params: [...paramsFromQuery(query), ...disabled],
  });
};

const shareUrl = (settings: Settings) => {
  const search = new URLSearchParams();
  const fields = {
    projectId: settings.projectId,
    filename: settings.filename,
    proxyPrefix: settings.proxyPrefix,
    query: serializeParams(settings.params.filter(({ isEnabled }) => isEnabled)),
    off: serializeParams(settings.params.filter(({ isEnabled }) => !isEnabled)),
  };
  for (const [key, value] of Object.entries(fields)) if (value) search.set(key, value);
  return `${window.location.origin}${window.location.pathname}?${search}`;
};

const isRunnable = (settings: Settings) =>
  /^\d+$/.test(settings.projectId) &&
  isDatoImageFilename(settings.filename) &&
  Boolean(parseUrlInput(settings.proxyPrefix)?.proxyPrefix);

const withQuery = (base: string, query: string) => (query ? `${base}?${query}` : base);

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

const cacheSummary = (result?: ProbeResult) =>
  ['cf-cache-status', 'x-cache', 'age']
    .filter((name) => result?.headers[name])
    .map((name) => `${name}: ${result?.headers[name]}`)
    .join(' · ');

/** Bodies over the server's preview limit fall back to loading the raw URL. */
const imageSource = (result?: ProbeResult) =>
  result?.previewUrl ?? (result && isPreviewable(result.format) ? result.url : null);

/** Places the popup beside the thumbnail, kept inside the viewport. */
const zoomPosition = (anchor: DOMRect) => ({
  left: Math.max(
    ZOOM_GAP,
    Math.min(anchor.right + ZOOM_GAP, window.innerWidth - ZOOM_WIDTH - ZOOM_GAP),
  ),
  top: Math.max(
    ZOOM_GAP,
    Math.min(
      anchor.top + anchor.height / 2 - ZOOM_HEIGHT / 2,
      window.innerHeight - ZOOM_HEIGHT - ZOOM_GAP,
    ),
  ),
});

/** Shortens a URL in the middle, so the host and the query both stay visible. */
const truncateMiddle = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  const head = Math.ceil((maxLength - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (maxLength - 1 - head))}`;
};

type ThumbProps = { title: string; result?: ProbeResult };

/**
 * Thumbnail of the tested bytes; clicking opens the raw URL. Hovering shows a larger preview
 * with a title and link, which stays open while the pointer is over the thumbnail or the popup.
 */
const Thumb = ({ title, result }: ThumbProps) => {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const source = imageSource(result);
  if (!result || !source) return <span className="thumb thumb-empty" />;

  const keepOpen = () => clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setAnchor(null), ZOOM_CLOSE_DELAY_MS);
  };

  return (
    <>
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        className="thumb"
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={(event) => {
          keepOpen();
          setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={scheduleClose}
      >
        <img src={source} alt={title} loading="lazy" />
      </a>
      {anchor &&
        createPortal(
          <div
            className="thumb-zoom"
            style={zoomPosition(anchor)}
            onMouseEnter={keepOpen}
            onMouseLeave={scheduleClose}
          >
            <h5>{title}</h5>
            <a href={result.url} target="_blank" rel="noreferrer" title={result.url}>
              {truncateMiddle(result.url, URL_DISPLAY_LENGTH)}
            </a>
            <img src={source} alt={title} />
          </div>,
          document.body,
        )}
    </>
  );
};

const Result = ({ title, result }: ThumbProps) => (
  <div className="result-cell">
    <Thumb title={title} result={result} />
    <span>{describe(result)}</span>
  </div>
);

const Badge = ({ level }: { level?: Level }) => (
  <span className={`badge badge-${level ?? 'pending'}`}>{level ?? 'running'}</span>
);

const Side = ({ title, result }: { title: string; result?: ProbeResult }) => {
  const source = imageSource(result);
  return (
    <div className="side">
      <h4>{title}</h4>
      {source ? <img src={source} alt={title} /> : <div className="noimg">No image</div>}
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
              <td>{result.ms} ms</td>
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
};

export const App = () => {
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const hasAutoRun = useRef(false);

  const update = (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch }));

  const applyUrlInput = (raw: string) => {
    const parsed = parseUrlInput(raw);
    if (parsed) update(toSettingsPatch(parsed));
    return Boolean(parsed);
  };

  /** Parses a pasted URL into fields instead of dumping it into one input. */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (applyUrlInput(event.clipboardData.getData('text'))) event.preventDefault();
  };

  const isReady = isRunnable(settings) && server?.isAvailable === true;

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareUrl(normalizeSettings(settings)));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  const run = async (rawSettings: Settings) => {
    const current = normalizeSettings(rawSettings);
    setSettings(current);
    window.history.replaceState(null, '', shareUrl(current));
    setExpanded(null);
    setIsRunning(true);

    const originBase = `${ORIGIN_HOST}/${current.projectId}/${current.filename}`;
    const proxyBase = `${current.proxyPrefix}${current.filename}`;
    const tests = buildTestCases(
      serializeParams(current.params.filter(({ isEnabled }) => isEnabled)),
    );
    setRows(tests.map((test) => ({ test })));

    const execute = async (test: TestCase) => {
      const [original, proxied] = await Promise.all([
        probe(withQuery(originBase, test.query), test.accept),
        probe(withQuery(proxyBase, test.query), test.accept),
      ]);
      const verdict = compare(test, original, proxied);
      setRows((rows) =>
        rows.map((row) => (row.test.id === test.id ? { test, original, proxied, verdict } : row)),
      );
    };

    // Negotiation and user rows share a URL per group and must run in order to expose a
    // poisoned cache; the param rows are independent.
    const isSequential = (test: TestCase) => test.group !== 'params';
    for (const test of tests.filter(isSequential)) await execute(test);
    await runPool(
      tests.filter((test) => !isSequential(test)).map((test) => () => execute(test)),
      PARALLEL_REQUESTS,
    );
    setIsRunning(false);
  };

  // A shared link runs as soon as the server check settles.
  useEffect(() => {
    detectServer().then((info) => {
      setServer(info);
      if (hasAutoRun.current || !info.isAvailable || !isRunnable(settings)) return;
      hasAutoRun.current = true;
      run(settings);
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
          <code>auto=format</code> negotiation. Requests go from the checker's server
          {server?.region ? ` (${server.region})` : ''} straight to both hosts. Nothing is cached or
          stored: all settings live in this page's URL.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(settings);
        }}
      >
        <label className="wide">
          Paste a URL (origin or proxied) to fill the fields
          <input
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              applyUrlInput(event.target.value);
            }}
            placeholder="https://www.datocms-assets.com/12345/1700000000-photo.png?w=800"
          />
        </label>
        <label>
          Project ID
          <input
            value={settings.projectId}
            onChange={(event) => update({ projectId: event.target.value.trim() })}
            onPaste={handlePaste}
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
            onPaste={handlePaste}
            placeholder="1700000000-photo.png"
            required
          />
          {settings.filename && !isDatoImageFilename(settings.filename) && (
            <span className="warn-text">{INVALID_FILENAME_MESSAGE}</span>
          )}
        </label>
        <label className="wide">
          <span>
            Proxy prefix (replaces <code>{ORIGIN_HOST}/&lt;project&gt;/</code>). Paste a full
            proxied URL and it splits off the filename and params.
          </span>
          <input
            value={settings.proxyPrefix}
            onChange={(event) => update({ proxyPrefix: event.target.value })}
            onPaste={handlePaste}
            onBlur={() => setSettings(normalizeSettings)}
            placeholder="https://example.com/assets/"
            required
          />
        </label>
        <div className="wide params-field">
          <span className="field-label">
            Your query params: run as their own test under each simulated <code>Accept</code>{' '}
            header. Paste a query string or URL into a name field to fill several rows.
          </span>
          <ParamGrid
            params={settings.params.length ? settings.params : [newParam()]}
            onChange={(params) => update({ params })}
          />
        </div>
        <p className="wide sim-note">
          <strong>Simulation:</strong> the checker sets the <code>Accept</code> header by hand to
          imitate AVIF-capable, WebP-only and legacy clients. No real browser negotiation happens.
        </p>
        {server?.isAvailable === false && (
          <p className="wide warn-text">
            The checker's server function is unreachable, so checks can't run. Use{' '}
            <code>npm run dev</code> or the Vercel deployment.
          </p>
        )}
        <div className="actions wide">
          <button type="submit" disabled={!isReady || isRunning}>
            {isRunning ? 'Running…' : 'Run checks'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!isRunnable(settings)}
            onClick={copyShareLink}
          >
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
              · {rows.length} tests · hover a thumbnail to enlarge, click it to open the raw URL,
              click a row for full headers
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
                  <th>Proxy cache</th>
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
                          <td>
                            <Result title="Origin (DatoCMS)" result={original} />
                          </td>
                          <td>
                            <Result title="Proxy (customer)" result={proxied} />
                          </td>
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
                                <Side title="Origin (DatoCMS)" result={original} />
                                <Side title="Proxy (customer)" result={proxied} />
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
