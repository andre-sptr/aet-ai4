import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';

export interface ImageStorage {
  put(bytes: Buffer, mimeType: string, extension: string): Promise<string>;
}

export function configuredImageStorage(): ImageStorage | undefined {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return undefined;
  return {
    async put(bytes, contentType, extension) {
      const { put } = await import('@vercel/blob');
      const result = await put(`aet/${randomUUID()}.${extension}`, bytes, { access: 'public', contentType, token, addRandomSuffix: false });
      return result.url;
    },
  };
}

export function validateImage(bytes: Buffer, claimedType: string): { mimeType: string; extension: string } {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new ApiError(413, 'IMAGE_SIZE', 'Gambar harus berukuran 1 byte hingga 5 MB.');
  let actual: { mimeType: string; extension: string } | undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) actual = { mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) actual = { mimeType: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) actual = { mimeType: 'image/webp', extension: 'webp' };
  if (!actual || claimedType !== actual.mimeType) throw new ApiError(415, 'IMAGE_TYPE', 'Isi gambar harus PNG, JPEG, atau WebP yang sesuai tipe berkas.');
  return actual;
}

export async function validateDecodedImage(bytes: Buffer, claimedType: string) {
  const image = validateImage(bytes, claimedType);
  try {
    const { default: sharp } = await import('sharp');
    const decoder = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning', animated: false });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 12_000 || metadata.height > 12_000 || (metadata.pages ?? 1) > 1) throw new Error('Image dimensions not supported');
    // Decode all pixels, so a fabricated header or truncated file is not an upload.
    await decoder.stats();
    return image;
  } catch {
    throw new ApiError(415, 'IMAGE_CONTENT', 'Gambar rusak atau dimensinya melampaui batas.');
  }
}
