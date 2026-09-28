/**
 * DatoCMS names uploads `<unix timestamp>-<slug>.<ext>`, with slug and extension lowercased
 * to `[a-z0-9_-]`. Only extensions imgix renders as images count.
 */
const DATO_IMAGE_FILENAME =
  /^\d{9,}-[a-z0-9_-]*\.(avif|bmp|gif|heic|heif|ico|jp2|jpeg|jpg|jxl|pdf|png|svg|tif|tiff|webp)$/;

export const isDatoImageFilename = (filename: string) => DATO_IMAGE_FILENAME.test(filename);

export const INVALID_FILENAME_MESSAGE =
  "Doesn't look like a DatoCMS image filename (expected `<timestamp>-<slug>.<image extension>`, e.g. 1700000000-photo.png).";

/** Checks the last path segment of `url`; on the origin host, also the `/<projectId>/` prefix. */
export const isDatoImageUrl = (url: URL) => {
  const segments = url.pathname.split('/').filter(Boolean);
  const filename = decodeURIComponent(segments.at(-1) ?? '');
  if (url.hostname.endsWith('datocms-assets.com')) {
    return segments.length === 2 && /^\d+$/.test(segments[0]) && isDatoImageFilename(filename);
  }
  return isDatoImageFilename(filename);
};
