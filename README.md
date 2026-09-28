# Imgix Proxy Checker

Checks that a reverse proxy in front of `www.datocms-assets.com` serves DatoCMS images correctly. It requests the same asset from both hosts, across common imgix params, and compares format, dimensions, bytes and headers.

## What it checks

- **Format negotiation:** it requests `auto=format` with three simulated `Accept` headers (AVIF-capable, WebP-only, generic).
  - **Accept not forwarded:** an AVIF-capable request gets PNG or JPEG from the proxy.
  - **Accept missing from the cache key:** the generic request gets the cached AVIF. The three requests share one fresh URL and run in order, so this case shows up.
- **Common imgix params:** resizing, cropping, focal points, `fm`, `q`, `auto=compress`, `dpr`, adjustments, text overlays and `dl`. The test passes when the proxy returns byte-identical output.
- **Relayed headers:** `Content-Disposition`, `Cache-Control` and the CORS and timing headers must match the origin (server mode only).
- **Redirects:** it warns when the proxy redirects.

## Fetch modes

| Mode | Requests leave from | Visible headers |
| --- | --- | --- |
| Checker server | The `/api/inspect` Vercel Function | All of them, including `cf-cache-status`, `x-cache`, `age` |
| This browser | The viewer's browser, `fetch` with `cache: 'no-store'` | CORS-safelisted headers only (`Content-Type`, `Cache-Control`, …) |

Neither mode caches anything. `Accept` values are always simulated: both modes set the header by hand, so no real browser negotiation happens.

## Sharing a run

The page stores every setting in its query string and runs on load when the link is complete. **Copy share link** gives a URL that reproduces the run. The repo and the server store nothing.

| Param | Meaning |
| --- | --- |
| `projectId` | DatoCMS project ID (the first path segment on `www.datocms-assets.com`) |
| `filename` | Asset filename |
| `proxyPrefix` | Proxy URL that replaces `https://www.datocms-assets.com/<projectId>/` |
| `extraParams` | Query string added to every test |
| `customQueries` | Newline-separated extra test queries |
| `mode` | `server` (default) or `browser` |

## Hosting

Vercel runs the function in `dub1` (Dublin), set in `vercel.json`, so requests to both hosts leave from the EU.

## Development

```sh
npm install
npm run dev
```

The Vite dev and preview servers mount the same handler that Vercel serves at `/api/inspect`, so server mode works locally.

## `/api/inspect`

`GET /api/inspect?url=<https URL>&accept=<Accept header>` returns JSON. The response has status, headers, sniffed format, dimensions, byte count, SHA-256 and, when the body is under 2.5 MB, a data URL preview. The endpoint fails fast with a 400, before any upstream fetch, unless the URL is on a public `https` hostname and ends in a DatoCMS image filename (`<unix timestamp>-<slug>.<image extension>`). On `www.datocms-assets.com`, it also requires the `/<projectId>/` prefix. It never returns raw bodies, which keeps it from working as a general proxy.
