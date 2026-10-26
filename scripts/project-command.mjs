import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, win32 } from 'node:path';

const require = createRequire(import.meta.url);

/** Invoke JavaScript CLIs through Node, including on Windows where .cmd is not executable by spawn. */
export function resolveProjectCommand(command, args = [], options = {}) {
  const node = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const resolveModule = options.resolveModule ?? (name => require.resolve(name));
  const exists = options.fileExists ?? existsSync;
  const path = (options.platform ?? process.platform) === 'win32' ? win32 : posix;
  let entry;
  if (command === 'node') return { command: node, args: [...args] };
  if (command === 'tsx') entry = resolveModule('tsx/cli');
  else if (command === 'prisma') entry = resolveModule('prisma/build/index.js');
  else if (command === 'npm') {
    const candidates = [
      env.npm_execpath,
      path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.resolve(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    entry = candidates.find(candidate => candidate && /npm-cli\.js$/i.test(candidate) && exists(candidate));
    if (!entry) throw new Error('npm CLI tidak ditemukan. Jalankan perintah ini melalui npm run dan pastikan Node.js/npm terpasang.');
  } else throw new Error(`Perintah proyek tidak didukung: ${command}`);
  return { command: node, args: [entry, ...args] };
}

export function spawnProjectCommand(command, args, options = {}) {
  const invocation = resolveProjectCommand(command, args, { env: options.env });
  return spawn(invocation.command, invocation.args, { stdio: 'inherit', ...options, shell: false });
}
