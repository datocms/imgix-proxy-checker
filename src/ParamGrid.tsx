import type { ClipboardEvent } from 'react';
import { IMGIX_ALIASES, IMGIX_PARAMS } from './imgix-params';
import type { QueryParam } from './tests';

export const newParam = (key = '', value = ''): QueryParam => ({
  id: crypto.randomUUID(),
  key,
  value,
  isEnabled: true,
});

/** Splits `a=1&b=2`, `?a=1` or a full URL's query into grid rows. */
export const paramsFromQuery = (query: string): QueryParam[] =>
  Array.from(new URLSearchParams(query.replace(/^[^?]*\?/, '')), ([key, value]) =>
    newParam(key, value),
  );

const ImgixPill = ({ name }: { name: string }) => {
  const key = name.trim().toLowerCase();
  if (!key) return <span className="pill-slot" />;
  const canonical = IMGIX_PARAMS[key] ? key : IMGIX_ALIASES[key];
  const param = canonical ? IMGIX_PARAMS[canonical] : undefined;
  if (!param) {
    return (
      <span className="pill-slot">
        <span className="pill pill-unknown" title="Not an imgix rendering parameter">
          unknown
        </span>
      </span>
    );
  }
  return (
    <span className="pill-slot">
      <a
        className="pill pill-imgix"
        href={param.url}
        target="_blank"
        rel="noreferrer"
        title={
          canonical === key ? param.description : `Alias of ${canonical}. ${param.description}`
        }
      >
        imgix{canonical === key ? '' : ` · ${canonical}`}
      </a>
    </span>
  );
};

type ParamGridProps = {
  params: QueryParam[];
  onChange: (params: QueryParam[]) => void;
};

/** Editable key/value rows; each row can be toggled, edited or removed. */
export const ParamGrid = ({ params, onChange }: ParamGridProps) => {
  const patch = (id: string, change: Partial<QueryParam>) =>
    onChange(params.map((param) => (param.id === id ? { ...param, ...change } : param)));

  /** A pasted query string or URL expands into rows, replacing the row it landed in. */
  const handleKeyPaste = (id: string, event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim();
    if (!/[=&?]/.test(text)) return;
    event.preventDefault();
    const index = params.findIndex((param) => param.id === id);
    onChange([...params.slice(0, index), ...paramsFromQuery(text), ...params.slice(index + 1)]);
  };

  return (
    <div className="param-grid">
      {params.map((param) => (
        <div key={param.id} className={`param-row${param.isEnabled ? '' : ' is-disabled'}`}>
          <input
            type="checkbox"
            checked={param.isEnabled}
            onChange={(event) => patch(param.id, { isEnabled: event.target.checked })}
            aria-label="Include this param"
          />
          <input
            value={param.key}
            onChange={(event) => patch(param.id, { key: event.target.value })}
            onPaste={(event) => handleKeyPaste(param.id, event)}
            placeholder="param"
            aria-label="Param name"
          />
          <input
            value={param.value}
            onChange={(event) => patch(param.id, { value: event.target.value })}
            placeholder="value"
            aria-label="Param value"
          />
          <ImgixPill name={param.key} />
          <button
            type="button"
            className="icon-button"
            onClick={() => onChange(params.filter(({ id }) => id !== param.id))}
            aria-label="Remove param"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary add-param"
        onClick={() => onChange([...params, newParam()])}
      >
        + Add param
      </button>
    </div>
  );
};
