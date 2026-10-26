import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from './auth.js';
import { createPrismaClient } from './db.js';

class CliInputError extends Error {}

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('admin:create requires an interactive terminal; passwords must not be passed as command-line arguments.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in the root local environment first.');

let muted = false;
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const terminal = createInterface({ input: process.stdin, output, terminal: true });
const abort = new AbortController();
terminal.once('SIGINT', () => abort.abort());
const question = (prompt: string) => terminal.question(prompt, { signal: abort.signal });
const db = createPrismaClient(process.env.DATABASE_URL);
try {
  const username = (await question('Nama pengguna administrator: ')).trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) throw new CliInputError('Nama pengguna harus berisi 3–100 huruf, angka, titik, garis bawah, atau tanda hubung.');
  if (await db.admin.findUnique({ where: { username } })) throw new CliInputError('Administrator dengan nama tersebut sudah ada.');
  process.stdout.write('Kata sandi (12–256 karakter, tidak ditampilkan): ');
  muted = true;
  const password = await question('');
  muted = false;
  process.stdout.write('\nUlangi kata sandi: ');
  muted = true;
  const confirmation = await question('');
  muted = false;
  process.stdout.write('\n');
  if (password !== confirmation) throw new CliInputError('Konfirmasi kata sandi tidak sama.');
  if (password.length < 12 || password.length > 256) throw new CliInputError('Kata sandi harus berisi 12–256 karakter.');
  await db.admin.create({ data: { username, passwordHash: await hashPassword(password) } });
  console.info('Administrator berhasil dibuat. Masuk melalui halaman /login/.');
} catch (error) {
  muted = false;
  process.stdout.write('\n');
  console.error(abort.signal.aborted ? 'Pembuatan administrator dibatalkan.' : error instanceof CliInputError ? error.message : 'Administrator tidak dapat dibuat. Periksa koneksi database dan migrasi; rincian kredensial tidak dicatat.');
  process.exitCode = abort.signal.aborted ? 130 : 1;
} finally {
  muted = false;
  terminal.close();
  await db.$disconnect();
}
