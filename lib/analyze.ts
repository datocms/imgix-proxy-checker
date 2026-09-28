import { imageSize } from 'image-size';

export type ImageFormat =
  | 'avif'
  | 'webp'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'heic'
  | 'svg'
  | 'pdf'
  | 'unknown';

export type BodyStats = {
  /** Sniffed from magic bytes, not from Content-Type. */
  format: ImageFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
};

export type ProbeResult = BodyStats & {
  url: string;
  /** Differs from `url` when the host redirected. */
  finalUrl: string;
  status: number;
  error?: string;
  ms: number;
  headers: Record<string, string>;
  /** Data URL of the tested bytes; null for non-images or oversized bodies. */
  previewUrl: string | null;
};

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** Identifies the file format from its leading bytes. */
export const sniffFormat = (bytes: Uint8Array): ImageFormat => {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (ascii(bytes, 0, 4) === '%PDF') return 'pdf';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand.startsWith('hei') || brand === 'mif1') return 'heic';
  }
  if (/<svg|<\?xml/.test(ascii(bytes, 0, 256))) return 'svg';
  return 'unknown';
};

export const isPreviewable = (format: ImageFormat) => format !== 'unknown' && format !== 'pdf';

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Computes format, size, dimensions and SHA-256 of a response body. */
export const analyzeBody = async (body: Uint8Array<ArrayBuffer>): Promise<BodyStats> => {
  const format = sniffFormat(body.subarray(0, 256));
  let dimensions = { width: null as number | null, height: null as number | null };
  if (isPreviewable(format)) {
    try {
      const { width, height } = imageSize(body);
      dimensions = { width, height };
    } catch {
      // Unparseable image: leave dimensions unknown.
    }
  }
  return {
    format,
    bytes: body.byteLength,
    ...dimensions,
    sha256: toHex(await crypto.subtle.digest('SHA-256', body)),
  };
};

export const emptyStats: BodyStats = {
  format: 'unknown',
  bytes: 0,
  width: null,
  height: null,
  sha256: '',
};
