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

/** Params win over `extra`, so each row tests what its label says. */
const mergeQuery = (extra: string, query: string) => {
  const merged = new URLSearchParams(extra);
  new URLSearchParams(query).forEach((value, key) => merged.set(key, value));
  // imgix reads commas and colons literally (rect=0,0,200,200, ar=1:1), so send them unescaped.
  return merged.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');
};

/**
 * Builds the full test matrix for one run.
 *
 * Negotiation rows use a width unique to this run so the first request misses every cache.
 * They run in order (AVIF, WebP, generic) and share one URL: if the proxy forwards `Accept`
 * but leaves it out of its cache key, the generic row gets the cached AVIF.
 */
export const buildTestCases = (extra: string, customQueries: string[]): TestCase[] => {
  const runWidth = 401 + Math.floor(Math.random() * 400);
  const negotiationQuery = mergeQuery(extra, `w=${runWidth}&auto=format`);

  const negotiation = (
    [
      {
        id: 'neg-avif',
        label: 'auto=format → AVIF',
        accept: ACCEPT_PROFILES.avif.value,
        acceptLabel: ACCEPT_PROFILES.avif.label,
        expect: { formats: ['avif'], hint: NOT_FORWARDED_HINT },
      },
      {
        id: 'neg-webp',
        label: 'auto=format → WebP',
        accept: ACCEPT_PROFILES.webp.value,
        acceptLabel: ACCEPT_PROFILES.webp.label,
        expect: { formats: ['webp'], hint: NOT_FORWARDED_HINT },
      },
      {
        id: 'neg-generic',
        label: 'auto=format → fallback',
        accept: ACCEPT_PROFILES.generic.value,
        acceptLabel: ACCEPT_PROFILES.generic.label,
        expect: { formats: LEGACY_FORMATS, hint: POISONED_HINT },
      },
    ] satisfies Omit<TestCase, 'group' | 'query'>[]
  ).map((test): TestCase => ({ ...test, group: 'negotiation', query: negotiationQuery }));

  const params: TestCase[] = PARAM_CASES.map(([label, query], index) => ({
    id: `param-${index}`,
    group: 'params',
    label,
    query: mergeQuery(extra, query),
    accept: ACCEPT_PROFILES.generic.value,
    acceptLabel: ACCEPT_PROFILES.generic.label,
  }));

  const custom: TestCase[] = customQueries.map((query, index) => ({
    id: `custom-${index}`,
    group: 'custom',
    label: 'Custom',
    query: mergeQuery(extra, query),
    accept: ACCEPT_PROFILES.avif.value,
    acceptLabel: ACCEPT_PROFILES.avif.label,
  }));

  return [...negotiation, ...params, ...custom];
};
