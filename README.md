# Imgix Proxy Checker

Checks that a reverse proxy in front of `www.datocms-assets.com` serves DatoCMS images correctly. It requests the same asset from both hosts, across common imgix params, and compares format, dimensions, bytes and headers.

## What it checks

- **Format negotiation:** it requests `auto=format` with three simulated `Accept` headers (AVIF-capable, WebP-only, generic).
  - **Accept not forwarded:** an AVIF-capable request gets PNG or JPEG from the proxy.
  - **Accept missing from the cache key:** the generic request gets the cached AVIF. The three requests share one fresh URL and run in order, so this case shows up.
- **Common imgix params:** resizing, cropping, focal points, `fm`, `q`, `auto=compress`, `dpr`, adjustments, text overlays and `dl`. The test passes when the proxy returns byte-identical output.
- **Cache key (`Origin`):** a fresh URL goes through once with `Origin: https://imgix-proxy-checker.invalid`, then once without. The second response must carry `access-control-allow-origin: *`. The checker picks the header value; `/api/inspect` accepts only named variants (`variant=origin`), never arbitrary headers.
- **Your query:** the params in the grid run as their own test under each simulated `Accept` header, in order, so they get the same cache-key check.
- **Relayed headers:** `Content-Disposition`, `Cache-Control` and the CORS and timing headers must match the origin. A specific `access-control-allow-origin` on a request without `Origin` means the proxy's cache key ignores `Origin`.
- **Redirects:** it warns when the proxy redirects.

## How requests are made

The `/api/inspect` Vercel Function fetches every URL server-side from `dub1` (Dublin), with no caching, and returns all response headers, including `cf-cache-status`, `x-cache` and `age`. It sends no `Origin` header, so it can't leave a CORS response in the proxy's cache.

The results table groups rows into Failed, Warnings and Passed. The FAIL, WARN and PASS chips show or hide each section; passed rows start hidden. Its **Diff** column compares each pair pixel by pixel in the browser, not on the server. Pixels that differ by more than 8/255 in any channel show red over a dimmed copy of the origin. The diff only uses the previews the function returned: loading raw cross-origin URLs into a canvas would send an `Origin` header to the proxy.

`Accept` values are always simulated: the function sets the header by hand, so no real browser negotiation happens. Thumbnails show the exact bytes the function tested. Clicking one opens the raw URL in a new tab.

## Sharing a run

The page stores every setting in its query string and runs on load when the link is complete. **Copy share link** gives a URL that reproduces the run. The repo and the server store nothing.

| Param | Meaning |
| --- | --- |
| `projectId` | DatoCMS project ID (the first path segment on `www.datocms-assets.com`) |
| `filename` | Asset filename |
| `proxyPrefix` | Proxy URL that replaces `https://www.datocms-assets.com/<projectId>/` |
| `query` | Enabled params from the grid, as a query string |
| `off` | Disabled params from the grid, as a query string |

The page has two boxes, laid out like the request path: the customer's proxy (right) forwards to DatoCMS (left).

- **Origin (DatoCMS):** paste the image's full `www.datocms-assets.com` URL.
- **Proxy (customer):** paste the same image's full URL on the customer's domain.

Both URLs must end in the same filename: that's the only way to be sure both sides serve the same image. Each box shows the values it parsed, read-only. Both boxes add a missing `https://`, and move a pasted query string into the param grid.

## imgix parameters

`src/imgix-params.ts` lists imgix's official rendering parameters and aliases, with links to their docs. The grid uses it for the **imgix** pills. `npm run update:imgix-params` regenerates it from [imgix-url-params](https://github.com/imgix/imgix-url-params) (BSD-2-Clause).

## Hosting

`vercel.json` pins the function to `dub1` (Dublin), so requests to both hosts leave from the EU.

## Development

```sh
npm install
npm run dev
```

The Vite dev and preview servers mount the same handler that Vercel serves at `/api/inspect`, so checks work locally.

## `/api/inspect`

`GET /api/inspect?url=<https URL>&accept=<Accept header>` returns JSON. The response has status, headers, sniffed format, dimensions, byte count, SHA-256 and, when the body is under 2.5 MB, a data URL preview. The endpoint fails fast with a 400, before any upstream fetch, unless the URL is on a public `https` hostname and ends in a DatoCMS image filename (`<unix timestamp>-<slug>.<image extension>`). On `www.datocms-assets.com`, it also requires the `/<projectId>/` prefix. It never returns raw bodies, which keeps it from working as a general proxy.
