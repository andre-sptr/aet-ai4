import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import sharp from 'sharp';
import mammoth from 'mammoth';
import { unzipSync } from 'fflate';
import { AiError } from './errors.js';

export type ExtractedAttachment = { id: string; name: string; mimeType: string; size: number; text?: string; dataUrl?: string };
export const DOCUMENT_LIMIT = 8 * 1024 * 1024;
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const TEXT_LIMIT = 40_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function validateDocxArchive(buffer: Buffer): void {
  // Reject ZIP64/multidisk, encrypted entries, traversal and decompression bombs
  // before invoking any document parser. No archive member is written to disk.
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)) throw new AiError('FILE_INVALID', 'Arsip DOCX tidak valid.');
  const count = buffer.readUInt16LE(eocd + 10), offset = buffer.readUInt32LE(eocd + 16);
  if (!count || count > 500 || count === 65535 || offset >= eocd) throw new AiError('FILE_LIMIT', 'Struktur DOCX melebihi batas.');
  let cursor = offset, total = 0; const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new AiError('FILE_INVALID', 'Indeks DOCX tidak valid.');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const length = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    if (cursor + 46 + length + extra + comment > eocd || flags & 1 || ![0, 8].includes(method)) throw new AiError('FILE_INVALID', 'DOCX terenkripsi atau tidak didukung.');
    const name = buffer.subarray(cursor + 46, cursor + 46 + length).toString('utf8');
    total += size;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || names.has(name) || /vbaProject|\.exe$/i.test(name)) throw new AiError('FILE_INVALID', 'Isi DOCX tidak aman.');
    if (size > 8 * 1024 * 1024 || total > 30 * 1024 * 1024 || size > Math.max(compressed, 1) * 150) throw new AiError('FILE_LIMIT', 'Ukuran ekstraksi DOCX melebihi batas.');
    names.add(name); cursor += 46 + length + extra + comment;
  }
  if (!names.has('word/document.xml') || !names.has('[Content_Types].xml')) throw new AiError('FILE_INVALID', 'Berkas bukan dokumen DOCX.');
  const entries = unzipSync(buffer, { filter: file => /\.xml$|\.rels$/.test(file.name) });
  for (const data of Object.values(entries)) if (/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(data))) throw new AiError('FILE_INVALID', 'Deklarasi XML eksternal tidak diizinkan.');
}

function safeName(name: string): string {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180) || 'lampiran';
}
export async function extractAttachment(buffer: Buffer, claimedMime: string, filename: string): Promise<ExtractedAttachment> {
  const mime = claimedMime.split(';')[0]!.trim().toLowerCase();
  const image = ['image/png', 'image/jpeg', 'image/webp'].includes(mime);
  if (!buffer.length || buffer.length > (image ? IMAGE_LIMIT : DOCUMENT_LIMIT)) throw new AiError('FILE_SIZE', 'Lampiran kosong atau melebihi batas ukuran.', 413);
  const result: ExtractedAttachment = { id: randomUUID(), name: safeName(filename), mimeType: mime, size: buffer.length };
  if (image) {
    const signature = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!signature) throw new AiError('FILE_TYPE', 'Isi gambar tidak sesuai jenis berkas.', 415);
    try {
      const decoded = sharp(buffer, { limitInputPixels: 24_000_000, animated: false });
      const info = await decoded.metadata();
      if (!info.width || !info.height || (info.pages ?? 1) > 1) throw new Error('Unsupported image');
      // Reencode strips metadata and ensures the actual image fully decodes.
      const normalized = await decoded.rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      result.mimeType = 'image/jpeg';
      result.dataUrl = `data:image/jpeg;base64,${normalized.toString('base64')}`;
      result.size = normalized.length;
      return result;
    } catch { throw new AiError('FILE_INVALID', 'Gambar rusak atau dimensinya terlalu besar.', 422); }
  }
  let text: string;
  if (mime === 'text/plain') {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new AiError('FILE_INVALID', 'Dokumen TXT harus menggunakan UTF-8.', 422); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new AiError('FILE_TYPE', 'Dokumen berisi data biner.', 415);
    if (/^\s*(?:<!doctype html|<html|<svg|<script)/i.test(text)) throw new AiError('FILE_TYPE', 'Berkas HTML/SVG tidak diterima sebagai TXT.', 415);
  } else if (mime === 'application/pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new AiError('FILE_TYPE', 'Isi berkas bukan PDF.', 415);
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), password: '' });
    try {
      const info = await parser.getInfo();
      if (info.total > 100) throw new AiError('FILE_LIMIT', 'PDF maksimal 100 halaman.', 413);
      const content = await parser.getText();
      text = content.text;
      if (!text.trim()) throw new AiError('FILE_EMPTY', 'PDF tidak memiliki teks yang dapat diekstrak. Gunakan dokumen dengan teks, bukan hasil pindai.', 422);
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('FILE_INVALID', 'PDF rusak, terenkripsi, atau tidak dapat dibaca.', 422);
    } finally { await parser.destroy(); }
  } else if (mime === DOCX_MIME) {
    if (buffer.subarray(0, 4).toString('hex') !== '504b0304') throw new AiError('FILE_TYPE', 'Isi berkas bukan DOCX.', 415);
    try {
      validateDocxArchive(buffer);
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw new AiError('FILE_INVALID', 'Dokumen DOCX tidak dapat dibaca.', 422);
    }
  } else throw new AiError('FILE_TYPE', 'Gunakan PNG, JPEG, WebP, PDF, DOCX, atau TXT.', 415);
  text = text.replace(/\u0000/g, '').trim();
  if (!text) throw new AiError('FILE_EMPTY', 'Dokumen tidak memiliki teks yang dapat dibaca.', 422);
  if (text.length > TEXT_LIMIT) throw new AiError('FILE_LIMIT', 'Teks dokumen melebihi 40.000 karakter. Unggah bagian yang lebih singkat.', 413);
  result.text = text;
  return result;
}
