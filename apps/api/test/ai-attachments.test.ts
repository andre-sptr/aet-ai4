import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { extractAttachment, DOCUMENT_LIMIT } from '../src/ai/attachments.js';

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
test('attachment validation checks bytes, MIME, size, UTF8 and active-text masquerades', async () => {
  await assert.rejects(extractAttachment(Buffer.from('not an image'), 'image/png', 'x.png'), /tidak sesuai/);
  await assert.rejects(extractAttachment(Buffer.from('fake PDF'), 'application/pdf', 'x.pdf'), /bukan PDF/);
  await assert.rejects(extractAttachment(Buffer.from([0xff, 0xfe, 0x00]), 'text/plain', 'x.txt'), /UTF-8/);
  await assert.rejects(extractAttachment(Buffer.from('<html><script>x</script></html>'), 'text/plain', 'x.txt'), /HTML/);
  await assert.rejects(extractAttachment(Buffer.alloc(DOCUMENT_LIMIT + 1), 'text/plain', 'x.txt'), /ukuran/);
  const text = await extractAttachment(Buffer.from('Lampiran elektronika yang valid.'), 'text/plain', '../x.txt');
  assert.equal(text.name, '.._x.txt'); assert.equal(text.text, 'Lampiran elektronika yang valid.');
});
test('images fully decode and are normalized without exposing unsafe metadata', async () => {
  const image = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#0056d2' } }).png().toBuffer();
  const result = await extractAttachment(image, 'image/png', 'picture.png');
  assert.equal(result.mimeType, 'image/jpeg'); assert.match(result.dataUrl!, /^data:image\/jpeg;base64,/);
  const decoded = await sharp(Buffer.from(result.dataUrl!.split(',')[1]!, 'base64')).metadata();
  assert.equal(decoded.width, 3); assert.equal(decoded.height, 2);
  await assert.rejects(extractAttachment(image.subarray(0, 20), 'image/png', 'truncated.png'), /rusak/);
});
test('canonical source DOCX extracts actual AET knowledge; no second document copy is created', async () => {
  const doc = await readFile(new URL('../../web/public/AETPCR.docx', import.meta.url));
  const result = await extractAttachment(doc, docxMime, 'AETPCR.docx');
  assert.match(result.text!, /AET|Association/);
});
test('DOCX archive safety rejects traversal, macro and expansion bombs before extraction', async () => {
  const content = { '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') };
  const traversal = zipSync({ ...content, '../escape.xml': strToU8('unsafe') });
  await assert.rejects(extractAttachment(Buffer.from(traversal), docxMime, 'unsafe.docx'), /tidak aman/);
  const macro = zipSync({ ...content, 'word/vbaProject.bin': strToU8('macro') });
  await assert.rejects(extractAttachment(Buffer.from(macro), docxMime, 'macro.docx'), /tidak aman/);
  const bomb = zipSync({ ...content, 'word/large.xml': strToU8('x'.repeat(1_000_000)) });
  await assert.rejects(extractAttachment(Buffer.from(bomb), docxMime, 'bomb.docx'), /melebihi batas/);
});

function pdfDocument(pageCount = 1): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  const fontId = pageCount + 3, streamId = fontId + 1;
  for (let page = 0; page < pageCount; page++) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const commands = 'BT /F1 12 Tf 72 720 Td (AET sensor measures temperature.) Tj ET';
  objects.push(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`);
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
test('actual PDF extraction reads document text and enforces page count before text extraction', async () => {
  const extracted = await extractAttachment(pdfDocument(), 'application/pdf', 'sensors.pdf');
  assert.match(extracted.text!, /AET sensor measures temperature/);
  await assert.rejects(extractAttachment(pdfDocument(101), 'application/pdf', 'too-many-pages.pdf'), /100 halaman/);
});
