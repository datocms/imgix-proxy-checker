import type { ImageFormat } from '../lib/analyze.js';

export type TestGroup = 'negotiation' | 'params' | 'custom';

/** One imgix permutation, requested from both the origin and the proxy. */
export type TestCase = {
  id: string;
  group: TestGroup;
  label: string;
  /** Final query string, extra params already merged in. */
  query: string;
  accept: string;
  acceptLabel: string;
  /** Formats the proxied response must be in, on top of matching the origin. */
  expect?: { formats: ImageFormat[]; hint: string };
};

export const ACCEPT_PROFILES = {
  avif: {
    label: 'AVIF-capable (sim)',
    value: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  },
  webp: { label: 'WebP-only (sim)', value: 'image/webp,image/apng,image/*,*/*;q=0.8' },
  generic: { label: 'Generic */* (sim)', value: '*/*' },
} as const;

const LEGACY_FORMATS: ImageFormat[] = ['png', 'jpeg', 'gif'];

const NOT_FORWARDED_HINT =
  'The proxy is not forwarding the Accept header to the origin, so auto=format never negotiates.';

const POISONED_HINT =
  'The origin saw an Accept header, but the proxy cache key ignores it: a client that never asked for a next-gen format received one.';

/** Common imgix params. Each row keeps `w` so failures stay cheap to render. */
const PARAM_CASES: [label: string, query: string][] = [
  ['Untransformed original', ''],
  ['Width', 'w=400'],
  ['Height', 'h=300'],
  ['Crop to box', 'w=400&h=400&fit=crop'],
  ['Crop to focal point', 'w=400&h=400&fit=crop&crop=focalpoint&fp-x=0.2&fp-y=0.8'],
  ['Aspect ratio', 'w=400&ar=1:1&fit=crop'],
  ['Fit max', 'w=400&h=200&fit=max'],
  ['Fill solid', 'w=400&h=400&fit=fill&fill=solid&fill-color=ff0000'],
  ['Device pixel ratio', 'w=400&dpr=2'],
  ['Force JPEG', 'w=400&fm=jpg'],
  ['Force PNG', 'w=400&fm=png'],
  ['Force WebP', 'w=400&fm=webp'],
  ['Force AVIF', 'w=400&fm=avif'],
  ['Quality', 'w=400&fm=jpg&q=30'],
  ['auto=compress', 'w=400&auto=compress'],
  ['Blur', 'w=400&blur=100'],
  ['Saturation', 'w=400&sat=-100'],
  ['Source rectangle', 'w=400&rect=0,0,200,200'],
  ['Rotate', 'w=400&rot=90'],
  ['Flip', 'w=400&flip=h'],
  ['Padding + background', 'w=400&pad=20&bg=ff0000'],
  ['Text overlay', 'w=400&txt=Hello&txt-size=48&txt-color=ffffff'],
  ['Download filename', 'w=400&dl=download.png'],
];

/** One editable row of the user's query-param grid. */
export type QueryParam = { id: string; key: string; value: string; isEnabled: boolean };

/** Serializes params, keeping commas and colons literal as imgix expects (rect=0,0,200,200). */
export const serializeParams = (params: Pick<QueryParam, 'key' | 'value'>[]) => {
  const search = new URLSearchParams();
  for (const { key, value } of params) if (key.trim()) search.append(key.trim(), value);
  return search.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');
};

const ACCEPT_ORDER = [ACCEPT_PROFILES.avif, ACCEPT_PROFILES.webp, ACCEPT_PROFILES.generic];

/**
 * Builds the full test matrix for one run.
 *
 * Negotiation rows use a width unique to this run so the first request misses every cache.
 * They run in order (AVIF, WebP, generic) and share one URL: if the proxy forwards `Accept`
 * but leaves it out of its cache key, the generic row gets the cached AVIF. The user's own
 * query runs the same way, so it gets the same check.
 */
export const buildTestCases = (userQuery: string): TestCase[] => {
  const runWidth = 401 + Math.floor(Math.random() * 400);
  const negotiationQuery = `w=${runWidth}&auto=format`;

  const negotiation = (
    [
      {
        id: 'neg-avif',
        label: 'auto=format → AVIF',
        expect: { formats: ['avif'], hint: NOT_FORWARDED_HINT },
      },
      {
        id: 'neg-webp',
        label: 'auto=format → WebP',
        expect: { formats: ['webp'], hint: NOT_FORWARDED_HINT },
      },
      {
        id: 'neg-generic',
        label: 'auto=format → fallback',
        expect: { formats: LEGACY_FORMATS, hint: POISONED_HINT },
      },
    ] satisfies Pick<TestCase, 'id' | 'label' | 'expect'>[]
  ).map(
    (test, index): TestCase => ({
      ...test,
      group: 'negotiation',
      query: negotiationQuery,
      accept: ACCEPT_ORDER[index].value,
      acceptLabel: ACCEPT_ORDER[index].label,
    }),
  );

  const params: TestCase[] = PARAM_CASES.map(([label, query], index) => ({
    id: `param-${index}`,
    group: 'params',
    label,
    query,
    accept: ACCEPT_PROFILES.generic.value,
    acceptLabel: ACCEPT_PROFILES.generic.label,
  }));

  const custom: TestCase[] = userQuery
    ? ACCEPT_ORDER.map((profile, index) => ({
        id: `custom-${index}`,
        group: 'custom',
        label: 'Your query',
        query: userQuery,
        accept: profile.value,
        acceptLabel: profile.label,
      }))
    : [];

  return [...negotiation, ...params, ...custom];
};
