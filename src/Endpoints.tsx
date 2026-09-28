import type { ClipboardEvent, ReactNode } from 'react';
import { type Endpoints as ResolvedEndpoints, splitQuery } from './parse';

export const ORIGIN_HOST = 'https://www.datocms-assets.com';

type Fact = { label: string; value?: string };

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
        {facts.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value ? undefined : 'is-missing'}>{value || '—'}</dd>
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
  const { projectId, proxyPrefix, originFilename, proxyFilename } = resolved;
  const originUrl =
    projectId && originFilename ? `${ORIGIN_HOST}/${projectId}/${originFilename}` : '';
  const proxyUrl = proxyPrefix && proxyFilename ? `${proxyPrefix}${proxyFilename}` : '';

  return (
    <div className="endpoints wide">
      <EndpointBox
        side="origin"
        title="Origin (DatoCMS)"
        subtitle={
          <>
            The image's full <code>www.datocms-assets.com</code> URL.
          </>
        }
        value={originInput}
        placeholder="https://www.datocms-assets.com/12345/1700000000-photo.png"
        error={resolved.originError}
        onChange={onOriginChange}
        onQuery={onQuery}
        facts={[
          { label: 'Project ID', value: projectId },
          { label: 'Filename', value: originFilename },
          { label: 'Tested URL', value: originUrl },
        ]}
      />
      <ForwardArrow />
      <EndpointBox
        side="proxy"
        title="Proxy (customer)"
        subtitle="The same image's full URL on the customer's domain."
        value={proxyInput}
        placeholder="https://example.com/assets/1700000000-photo.png"
        error={resolved.proxyError}
        onChange={onProxyChange}
        onQuery={onQuery}
        facts={[
          { label: 'Host', value: hostOf(proxyPrefix) },
          { label: 'Path prefix', value: proxyPrefix && new URL(proxyPrefix).pathname },
          { label: 'Filename', value: proxyFilename },
          { label: 'Tested URL', value: proxyUrl },
        ]}
      />
    </div>
  );
};
