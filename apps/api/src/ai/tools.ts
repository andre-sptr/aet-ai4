import { randomInt } from 'node:crypto';
import { lookup as resolveDns } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { AiError } from './errors.js';
import { readBoundedBody, withAbort } from './limits.js';

export type ToolName = 'arithmetic' | 'convert' | 'statistics' | 'password' | 'format' | 'read-url' | 'search';
export type ToolCall = { name: ToolName; args: Record<string, unknown> };
export type Source = { id: string; title: string; url: string };
export type ToolResult = { name: ToolName; summary: string; text: string; sources: Source[]; available: boolean };
const ALLOWED = new Set<ToolName>(['arithmetic', 'convert', 'statistics', 'password', 'format', 'read-url', 'search']);

/** Shunting-yard arithmetic evaluator. Identifiers/functions/code are not grammar. */
export function arithmetic(input: string): number {
  if (!input.trim() || input.length > 240 || !/^[\d.\s()+*/%\-]+$/.test(input)) throw new AiError('TOOL_ARGUMENT', 'Gunakan ekspresi angka dan operator aritmetika saja.');
  const values: number[] = [], operators: string[] = [];
  const priority: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '~': 3 };
  function apply() {
    const op = operators.pop();
    const b = values.pop();
    if (b === undefined || !op) throw new AiError('TOOL_ARGUMENT', 'Ekspresi tidak valid.');
    if (op === '~') { values.push(-b); return; }
    const a = values.pop();
    if (a === undefined) throw new AiError('TOOL_ARGUMENT', 'Ekspresi tidak valid.');
    const v = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b;
    if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) throw new AiError('TOOL_ARGUMENT', 'Hasil aritmetika di luar batas.');
    values.push(v);
  }
  const tokens = input.match(/\d+(?:\.\d+)?|\.\d+|[()+*/%\-]/g) ?? [];
  if (tokens.join('') !== input.replace(/\s/g, '')) throw new AiError('TOOL_ARGUMENT', 'Angka tidak valid.');
  let expectingValue = true;
  for (const token of tokens) {
    if (/^(\d|\.)/.test(token)) {
      if (!expectingValue) throw new AiError('TOOL_ARGUMENT', 'Operator tidak ditemukan.');
      values.push(Number(token)); expectingValue = false;
    } else if (token === '(') {
      if (!expectingValue) throw new AiError('TOOL_ARGUMENT', 'Operator tidak ditemukan.');
      operators.push(token);
    } else if (token === ')') {
      if (expectingValue) throw new AiError('TOOL_ARGUMENT', 'Kurung tidak valid.');
      while (operators.length && operators.at(-1) !== '(') apply();
      if (operators.pop() !== '(') throw new AiError('TOOL_ARGUMENT', 'Kurung tidak seimbang.');
    } else {
      if (expectingValue) {
        if (token !== '-') throw new AiError('TOOL_ARGUMENT', 'Ekspresi tidak valid.');
        operators.push('~'); continue;
      }
      while (operators.length && operators.at(-1) !== '(' && priority[operators.at(-1)!]! >= priority[token]!) apply();
      operators.push(token); expectingValue = true;
    }
  }
  if (expectingValue) throw new AiError('TOOL_ARGUMENT', 'Ekspresi belum lengkap.');
  while (operators.length) {
    if (operators.at(-1) === '(') throw new AiError('TOOL_ARGUMENT', 'Kurung tidak seimbang.');
    apply();
  }
  if (values.length !== 1 || !Number.isFinite(values[0])) throw new AiError('TOOL_ARGUMENT', 'Ekspresi tidak valid.');
  return values[0]!;
}

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number), a = octets[0]!, b = octets[1]!;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0);
  }
  if (isIP(address) === 6) {
    const value = new URL(`https://[${address}]`).hostname.slice(1, -1).toLowerCase();
    // Accept only ordinary global unicast; reject mapped, tunneling, docs and special ranges.
    return /^[23][0-9a-f]{3}:/.test(value) && !/^(2001:(?:db8|0|1|2|10|20):|2002:)/.test(value);
  }
  return false;
}
export function validatePublicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AiError('UNSAFE_URL', 'URL tidak valid.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || url.href.length > 2048 || host === 'localhost' || !host.includes('.') && !isIP(host) || /\.(localhost|local|internal|test|invalid)$/.test(host) || isIP(host) && !publicAddress(host)) {
    throw new AiError('UNSAFE_URL', 'Hanya URL HTTPS publik yang diizinkan.');
  }
  return url;
}

type ResponseData = { status: number; location?: string; mime: string; body: string };
export type ReadDependencies = {
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  transport?: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<ResponseData>;
};
async function secureTransport(url: URL, target: { address: string; family: number }, signal: AbortSignal): Promise<ResponseData> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (typeof options === 'object' && options.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const req = httpsRequest(url, { method: 'GET', lookup, signal, headers: { Accept: 'text/html,text/plain,application/json', 'User-Agent': 'AETAI-Reader/1.0' } }, res => {
      const mime = String(res.headers['content-type'] ?? '').split(';')[0]!;
      if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400) { res.resume(); resolve({ status: res.statusCode!, location: res.headers.location, mime, body: '' }); return; }
      if (!['text/html', 'text/plain', 'application/json'].includes(mime)) { res.destroy(); reject(new AiError('TOOL_CONTENT', 'Jenis halaman tidak didukung.')); return; }
      if (Number(res.headers['content-length'] ?? 0) > 512_000) { res.destroy(); reject(new AiError('TOOL_SIZE', 'Halaman terlalu besar.')); return; }
      let bytes = 0; const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512_000) { res.destroy(new AiError('TOOL_SIZE', 'Halaman terlalu besar.')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 500, mime, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}
export async function readPublicUrl(input: string, signal?: AbortSignal, dependencies: ReadDependencies = {}): Promise<{ url: string; text: string }> {
  const abort = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]);
  let url = validatePublicUrl(input);
  const resolve = dependencies.resolve ?? (async (hostname: string) => resolveDns(hostname, { all: true, verbatim: true }));
  for (let redirects = 0; redirects <= 3; redirects++) {
    abort.throwIfAborted();
    const addresses = await withAbort(resolve(url.hostname.replace(/^\[|\]$/g, '')), abort);
    if (!addresses.length || addresses.some(target => !publicAddress(target.address))) throw new AiError('UNSAFE_URL', 'Alamat jaringan privat tidak diizinkan.');
    const result = await (dependencies.transport ?? secureTransport)(url, addresses[0]!, abort);
    if (result.status >= 300 && result.status < 400) {
      if (!result.location || redirects === 3) throw new AiError('TOOL_REDIRECT', 'Pengalihan halaman melebihi batas.');
      url = validatePublicUrl(new URL(result.location, url).href); continue;
    }
    if (result.status < 200 || result.status >= 300) throw new AiError('TOOL_HTTP', 'Halaman tidak dapat dibaca.', 502);
    const text = result.body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20_000);
    if (!text) throw new AiError('TOOL_CONTENT', 'Halaman tidak memiliki teks yang dapat dibaca.');
    return { url: url.href, text };
  }
  throw new AiError('TOOL_REDIRECT', 'Pengalihan halaman melebihi batas.');
}

export function planTools(text: string): ToolCall[] {
  if (/```|\b(?:jangan|tanpa|do not|don't)\b.{0,80}\b(?:alat|tool|web|search|cari|hitung)\b/i.test(text)) return [];
  const calculate = text.match(/^(?:hitung|calculate)\s*:?\s*([\d.\s()+*/%\-]+)[?!.]?$/i);
  if (calculate) return [{ name: 'arithmetic', args: { expression: calculate[1] } }];
  const conversion = text.match(/^(?:konversi(?:kan)?|convert)?\s*(-?\d+(?:\.\d+)?)\s*(mm|cm|m|km|in|ft|g|kg|lb|c|f|k)\s+(?:ke|to)\s*(mm|cm|m|km|in|ft|g|kg|lb|c|f|k)\s*[?!.]?$/i);
  if (conversion) return [{ name: 'convert', args: { value: Number(conversion[1]), from: conversion[2]!.toLowerCase(), to: conversion[3]!.toLowerCase() } }];
  const statistics = text.match(/^(?:statistik|statistics|rata-rata|mean)\s*:?\s*([-\d.,;\s]+)$/i);
  if (statistics) return [{ name: 'statistics', args: { values: statistics[1]!.split(/[,;]/).map(Number) } }];
  const password = text.match(/^(?:buat(?:kan)?|generate)\s+(?:password|kata sandi)(?:\s+(\d+))?(?:\s+karakter)?[.!]?$/i);
  if (password) return [{ name: 'password', args: { length: Number(password[1] ?? 20) } }];
  const format = text.match(/^(?:cek|validasi|check|validate)\s+(email|json)\s*:?\s*([\s\S]+)$/i);
  if (format) return [{ name: 'format', args: { format: format[1]!.toLowerCase(), value: format[2] } }];
  const page = text.match(/^(?:baca|ringkas|rangkum|read|summarize)\s+(?:halaman\s+|artikel\s+)?(https:\/\/\S+)\s*$/i);
  if (page) return [{ name: 'read-url', args: { url: page[1]!.replace(/[.,]$/, '') } }];
  const query = text.match(/^(?:cari(?:kan)?|search|berita terbaru|latest news)\s+(.{3,400})$/i);
  if (query) return [{ name: 'search', args: { query: query[1] } }];
  return [];
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new AiError('TOOL_ARGUMENT', 'Nilai angka tidak valid.');
  return value;
}
function string(value: unknown, maximum = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new AiError('TOOL_ARGUMENT', 'Argumen alat tidak valid.');
  return value;
}
export async function executeTool(call: ToolCall, options: { signal?: AbortSignal; fetcher?: typeof fetch; readDependencies?: ReadDependencies } = {}): Promise<ToolResult> {
  options.signal?.throwIfAborted();
  if (!ALLOWED.has(call.name)) throw new AiError('TOOL_ARGUMENT', 'Alat tidak diizinkan.');
  const args = call.args;
  let text = '', sources: Source[] = [];
  if (call.name === 'arithmetic') text = `Hasil perhitungan: ${arithmetic(string(args.expression, 240))}.`;
  if (call.name === 'convert') {
    const value = number(args.value), from = string(args.from).toLowerCase(), to = string(args.to).toLowerCase();
    const unit: Record<string, [string, number]> = { mm: ['length', .001], cm: ['length', .01], m: ['length', 1], km: ['length', 1000], in: ['length', .0254], ft: ['length', .3048], g: ['mass', .001], kg: ['mass', 1], lb: ['mass', .45359237] };
    let result: number;
    if (['c', 'f', 'k'].includes(from) && ['c', 'f', 'k'].includes(to)) {
      const kelvin = from === 'k' ? value : from === 'c' ? value + 273.15 : (value - 32) / 1.8 + 273.15;
      if (kelvin < 0) throw new AiError('TOOL_ARGUMENT', 'Suhu di bawah nol absolut.');
      result = to === 'k' ? kelvin : to === 'c' ? kelvin - 273.15 : (kelvin - 273.15) * 1.8 + 32;
    } else {
      if (!unit[from] || !unit[to] || unit[from]![0] !== unit[to]![0]) throw new AiError('TOOL_ARGUMENT', 'Dimensi satuan berbeda.');
      result = value * unit[from]![1] / unit[to]![1];
    }
    text = `${value} ${from} = ${Number(result.toPrecision(12))} ${to}.`;
  }
  if (call.name === 'statistics') {
    if (!Array.isArray(args.values) || !args.values.length || args.values.length > 1000) throw new AiError('TOOL_ARGUMENT', 'Gunakan 1–1000 angka.');
    const values = args.values.map(number).sort((a, b) => a - b), n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 ? values[Math.floor(n / 2)] : (values[n / 2 - 1]! + values[n / 2]!) / 2;
    text = `Jumlah data: ${n}; rata-rata: ${mean}; median: ${median}; minimum: ${values[0]}; maksimum: ${values.at(-1)}.`;
  }
  if (call.name === 'password') {
    const length = number(args.length);
    if (!Number.isInteger(length) || length < 12 || length > 128) throw new AiError('TOOL_ARGUMENT', 'Panjang kata sandi harus 12–128 karakter.');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    const value = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
    text = `Kata sandi acak kriptografis (${length} karakter):\n\n\`\`\`text\n${value}\n\`\`\`\n\nSimpan secara aman. Nilai ini tidak dicatat pada log server.`;
  }
  if (call.name === 'format') {
    const value = string(args.value, 12_000), format = string(args.format);
    if (format === 'email') text = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Format alamat email valid. Keberadaan kotak surat tidak diverifikasi.' : 'Format alamat email tidak valid.';
    else if (format === 'json') { try { JSON.parse(value); text = 'Sintaks JSON valid.'; } catch { text = 'Sintaks JSON tidak valid.'; } }
    else throw new AiError('TOOL_ARGUMENT', 'Format tidak didukung.');
  }
  if (call.name === 'read-url') {
    const page = await readPublicUrl(string(args.url, 2048), options.signal, options.readDependencies);
    text = page.text; sources = [{ id: 'web-1', title: 'Halaman yang dibaca', url: page.url }];
  }
  if (call.name === 'search') {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return { name: call.name, summary: 'Pencarian web belum dikonfigurasi', text: 'Pencarian web tidak tersedia: TAVILY_API_KEY belum dikonfigurasi. Tidak ada hasil atau sumber live yang diperoleh.', sources: [], available: false };
    const searchSignal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]);
    const response = await (options.fetcher ?? fetch)('https://api.tavily.com/search', { method: 'POST', redirect: 'error', signal: searchSignal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query: string(args.query, 400), max_results: 3, search_depth: 'basic' }) });
    if (!response.ok) { await response.body?.cancel(); throw new AiError('TOOL_HTTP', 'Pencarian web gagal.', 502); }
    const raw = await readBoundedBody(response, 128_000, searchSignal);
    const data = JSON.parse(raw) as { results?: { title?: string; url?: string; content?: string }[] };
    if (!Array.isArray(data.results)) throw new AiError('TOOL_CONTENT', 'Respons pencarian tidak valid.');
    const valid = data.results.slice(0, 3).filter(item => typeof item.title === 'string' && typeof item.content === 'string' && typeof item.url === 'string').filter(item => { try { validatePublicUrl(item.url!); return true; } catch { return false; } });
    sources = valid.map((item, i) => ({ id: `search-${i + 1}`, title: item.title!.slice(0, 200), url: item.url! }));
    text = valid.map((item, i) => `[${i + 1}] ${item.title}\n${item.content!.slice(0, 2000)}`).join('\n\n') || 'Tidak ada hasil pencarian yang dapat digunakan.';
  }
  return { name: call.name, summary: `Alat ${call.name} selesai`, text, sources, available: true };
}
