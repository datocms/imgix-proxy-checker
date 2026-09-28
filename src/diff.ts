import type { ProbeResult } from '../lib/analyze.js';

/** Channel difference (0–255) below which a pixel counts as unchanged, absorbing codec noise. */
export const DIFF_TOLERANCE = 8;
/** Longest side the comparison runs at; both images scale identically first. */
const MAX_DIFF_SIDE = 1024;

export type PixelDiff =
  | { kind: 'identical' }
  | { kind: 'skipped'; reason: string }
  | {
      kind: 'compared';
      maskUrl: string;
      /** Share of pixels whose largest channel difference exceeds the tolerance. */
      differingRatio: number;
      maxDelta: number;
      width: number;
      height: number;
    };

const decode = async (dataUrl: string) => createImageBitmap(await (await fetch(dataUrl)).blob());

const toPixels = (bitmap: ImageBitmap, width: number, height: number) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas unavailable');
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
};

/**
 * Compares the two tested images pixel by pixel, in the browser. Differing pixels show red,
 * brighter for larger differences, over a dimmed grayscale copy of the origin.
 *
 * Only data-URL previews are used: loading a raw cross-origin URL into a canvas would send an
 * `Origin` header, which can leave a CORS response in the proxy's cache.
 */
export const diffImages = async (
  original: ProbeResult,
  proxied: ProbeResult,
): Promise<PixelDiff> => {
  if (original.sha256 && original.sha256 === proxied.sha256) return { kind: 'identical' };
  const isDataUrl = (url: string | null) => url?.startsWith('data:') ?? false;
  if (!isDataUrl(original.previewUrl) || !isDataUrl(proxied.previewUrl)) {
    return { kind: 'skipped', reason: 'No preview to compare' };
  }
  if (original.width !== proxied.width || original.height !== proxied.height) {
    return { kind: 'skipped', reason: 'Dimensions differ' };
  }

  let bitmaps: ImageBitmap[];
  try {
    bitmaps = await Promise.all([
      decode(original.previewUrl as string),
      decode(proxied.previewUrl as string),
    ]);
  } catch {
    return { kind: 'skipped', reason: "This browser can't decode one of the images" };
  }

  const [originBitmap, proxyBitmap] = bitmaps;
  const scale = Math.min(1, MAX_DIFF_SIDE / Math.max(originBitmap.width, originBitmap.height));
  const width = Math.max(1, Math.round(originBitmap.width * scale));
  const height = Math.max(1, Math.round(originBitmap.height * scale));
  const originPixels = toPixels(originBitmap, width, height);
  const proxyPixels = toPixels(proxyBitmap, width, height);
  for (const bitmap of bitmaps) bitmap.close();

  const mask = new ImageData(width, height);
  let differing = 0;
  let maxDelta = 0;
  for (let index = 0; index < originPixels.length; index += 4) {
    const delta = Math.max(
      Math.abs(originPixels[index] - proxyPixels[index]),
      Math.abs(originPixels[index + 1] - proxyPixels[index + 1]),
      Math.abs(originPixels[index + 2] - proxyPixels[index + 2]),
      Math.abs(originPixels[index + 3] - proxyPixels[index + 3]),
    );
    maxDelta = Math.max(maxDelta, delta);
    if (delta > DIFF_TOLERANCE) {
      differing += 1;
      mask.data[index] = 128 + Math.min(127, delta);
      mask.data[index + 1] = 0;
      mask.data[index + 2] = 0;
    } else {
      const gray =
        (originPixels[index] * 0.3 +
          originPixels[index + 1] * 0.59 +
          originPixels[index + 2] * 0.11) *
        0.35;
      mask.data[index] = gray;
      mask.data[index + 1] = gray;
      mask.data[index + 2] = gray;
    }
    mask.data[index + 3] = 255;
  }

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')?.putImageData(mask, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return {
    kind: 'compared',
    maskUrl: URL.createObjectURL(blob),
    differingRatio: differing / (width * height),
    maxDelta,
    width,
    height,
  };
};
