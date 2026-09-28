import type { ClipboardEvent, ReactNode } from 'react';
import { type Endpoints as ResolvedEndpoints, splitQuery } from './parse';

export const ORIGIN_HOST = 'https://www.datocms-assets.com';

type Fact = { label: string; value?: string; note?: string };

type BoxProps = {
  side: 'origin' | 'proxy';
  title: string;
  subtitle: ReactNode;
  value: string;
  placeholder: string;
  facts: Fact[];
  error?: string;
  onChange: (value: string) => void;
  onQuery: (query: string) => void;
};

/** One side of the request path: a paste field plus the values parsed from it. */
const EndpointBox = ({
  side,
  title,
  subtitle,
  value,
  placeholder,
  facts,
  error,
  onChange,
  onQuery,
}: BoxProps) => {
  /** Keeps the box to the URL itself; a pasted query moves into the param grid. */
  const moveQueryOut = (raw: string) => {
    const { base, query } = splitQuery(raw);
    onChange(base);
    if (query) onQuery(query);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    moveQueryOut(event.clipboardData.getData('text'));
  };

  return (
    <section className={`endpoint endpoint-${side}`}>
      <h2>{title}</h2>
      <p className="endpoint-subtitle">{subtitle}</p>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={handlePaste}
        onBlur={() => value.includes('?') && moveQueryOut(value)}
        placeholder={placeholder}
        aria-label={`${title} URL`}
        spellCheck={false}
      />
      {error && <p className="warn-text">{error}</p>}
      <dl className="facts">
        {facts.map(({ label, value, note }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value ? undefined : 'is-missing'}>
              {value || '—'}
              {note && <span className="muted"> {note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

/** Big left-pointing arrow: the proxy forwards requests to the origin. */
const ForwardArrow = () => (
  <div className="forward-arrow" aria-hidden="true">
    <span>forwards to</span>
    <svg viewBox="0 0 120 40" width="120" height="40">
      <path d="M116 20H12M28 6 10 20l18 14" fill="none" strokeWidth="5" strokeLinecap="round" />
    </svg>
  </div>
);

type EndpointsProps = {
  originInput: string;
  proxyInput: string;
  resolved: ResolvedEndpoints;
  onOriginChange: (value: string) => void;
  onProxyChange: (value: string) => void;
  onQuery: (query: string) => void;
};

const hostOf = (prefix: string) => {
  try {
    return new URL(prefix).host;
  } catch {
    return '';
  }
};

/**
 * The two ends of the request path, laid out the way it flows: the customer's proxy on the
 * right forwards to DatoCMS on the left.
 */
export const Endpoints = ({
  originInput,
  proxyInput,
  resolved,
  onOriginChange,
  onProxyChange,
  onQuery,
}: EndpointsProps) => {
  const { projectId, filename, proxyPrefix, originFilename, proxyFilename } = resolved;
  // Each box shows its own filename, so a mismatch stays visible; it borrows the other's if empty.
  const originFile = originFilename ?? filename;
  const proxyFile = proxyFilename ?? filename;
  const originUrl = projectId && originFile ? `${ORIGIN_HOST}/${projectId}/${originFile}` : '';
  const proxyUrl = proxyPrefix && proxyFile ? `${proxyPrefix}${proxyFile}` : '';

  return (
    <div className="endpoints wide">
      <EndpointBox
        side="origin"
        title="Origin (DatoCMS)"
        subtitle={
          <>
            A <code>www.datocms-assets.com</code> URL, or just the project ID.
          </>
        }
        value={originInput}
        placeholder="https://www.datocms-assets.com/12345/1700000000-photo.png"
        error={resolved.originError}
        onChange={onOriginChange}
        onQuery={onQuery}
        facts={[
          { label: 'Project ID', value: projectId },
          {
            label: 'Filename',
            value: originFile,
            note: originFile && !originFilename ? '(from proxy URL)' : undefined,
          },
          { label: 'Tested URL', value: originUrl },
        ]}
      />
      <ForwardArrow />
      <EndpointBox
        side="proxy"
        title="Proxy (customer)"
        subtitle="The same image through the customer's domain, or just their asset path."
        value={proxyInput}
        placeholder="https://example.com/assets/1700000000-photo.png"
        error={resolved.proxyError}
        onChange={onProxyChange}
        onQuery={onQuery}
        facts={[
          { label: 'Host', value: hostOf(proxyPrefix) },
          { label: 'Path prefix', value: proxyPrefix && new URL(proxyPrefix).pathname },
          {
            label: 'Filename',
            value: proxyFile,
            note: proxyFile && !proxyFilename ? '(from origin URL)' : undefined,
          },
          { label: 'Tested URL', value: proxyUrl },
        ]}
      />
    </div>
  );
};
