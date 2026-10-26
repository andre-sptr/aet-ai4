import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, extname, dirname } from 'node:path';
import { loadManifest, projectRoot } from './route-manifest.js';

const webRoot = resolve(projectRoot, 'apps/web');
const out = join(webRoot, 'out');
const errors: string[] = [];

async function exists(path: string): Promise<boolean> {
  return stat(path).then(value => value.isFile()).catch(() => false);
}

async function files(root: string, excluded = new Set<string>()): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path, excluded));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function check(condition: unknown, message: string): void {
  if (!condition) errors.push(message);
}

const manifest = await loadManifest();
const routes = ['/', '/news/', '/events/', '/team/', '/login/', '/admin/', '/admin/news/', '/admin/events/', '/admin/team/', '/admin/ai/',
  ...manifest.news.map(({ slug }) => `/news/${slug}/`),
  ...manifest.events.map(({ id }) => `/events/${id}/`),
];

if (!await stat(out).then(value => value.isDirectory()).catch(() => false)) {
  throw new Error('Static export is missing: run npm run build:web; expected apps/web/out/.');
}
for (const route of routes) check(await exists(join(out, route, 'index.html')), `Missing static route ${route}index.html`);
check(await exists(join(out, '404.html')), 'Missing static 404.html.');

const sourceFiles = await files(projectRoot, new Set(['node_modules', '.next', 'out', 'dist', '.git', 'coverage']));
const docSources = sourceFiles.filter(path => path.endsWith('/AETPCR.docx'));
check(docSources.length === 1 && docSources[0] === join(webRoot, 'public/AETPCR.docx'), 'AETPCR.docx must have exactly one source copy at apps/web/public/AETPCR.docx.');
const docOut = join(out, 'AETPCR.docx');
check(await exists(docOut), 'Exported AETPCR.docx is missing.');
if (docSources.length === 1 && await exists(docOut)) {
  const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  check(digest(await readFile(docSources[0])) === digest(await readFile(docOut)), 'Exported AETPCR.docx differs from the canonical source.');
}

const exportedFiles = await files(out);
check(exportedFiles.some(path => path.endsWith('.woff2')), 'No local WOFF2 font was exported.');
check(exportedFiles.some(path => path.endsWith('.css')), 'No stylesheet was exported.');
check(exportedFiles.some(path => path.endsWith('.js')), 'No browser JavaScript was exported.');

for (const path of exportedFiles.filter(path => path.endsWith('.html') || path.endsWith('.css'))) {
  const text = await readFile(path, 'utf8');
  const refs = path.endsWith('.html')
    ? [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
    : [...text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g)].map(match => match[1]);
  for (const reference of refs) {
    const decoded = reference.replaceAll('&amp;', '&');
    if (/^(?:https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(decoded)) continue;
    const pathPart = decoded.split(/[?#]/)[0];
    if (!/\.(?:css|js|woff2?|ttf|otf|ico|svg|png|jpe?g|webp|docx)$/i.test(pathPart)) continue;
    let assetPath: string;
    try {
      assetPath = pathPart.startsWith('/') ? resolve(out, `.${decodeURIComponent(pathPart)}`) : resolve(dirname(path), decodeURIComponent(pathPart));
    } catch {
      errors.push(`Invalid asset URL in ${relative(out, path)}.`);
      continue;
    }
    check(assetPath.startsWith(`${out}/`) && await exists(assetPath), `Broken local asset ${pathPart} in ${relative(out, path)}.`);
  }
}

for (const path of sourceFiles.filter(path => path.startsWith(`${webRoot}/`) && /\.[cm]?[jt]sx?$/.test(path))) {
  const text = await readFile(path, 'utf8');
  check(!/\/app\/api\/|\/app\/.*\/route\.[cm]?[jt]sx?$/.test(path), `Runtime route handler found in static frontend: ${relative(webRoot, path)}.`);
  check(!/^[\s;]*["']use server["']/m.test(text), `Server action found in static frontend: ${relative(webRoot, path)}.`);
  check(!/(?:from\s*|import\s*\()["'](?:@prisma\/client|fastify|@fastify\/[^"']+|pg|server-only)["']/.test(text), `Backend-only dependency found in static frontend: ${relative(webRoot, path)}.`);
}

const sensitiveNames = ['SUMOPOD_API_KEY', 'SESSION_SECRET', 'DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'TAVILY_API_KEY', 'STATIC_REBUILD_HOOK_URL'];
const sensitiveValues = sensitiveNames.map(name => process.env[name]).filter((value): value is string => Boolean(value && value.length >= 12 && !/^(?:replace-|postgresql:\/\/postgres:postgres@localhost)/.test(value)));
for (const path of exportedFiles.filter(path => ['.html', '.js', '.json', '.css', '.map', '.txt'].includes(extname(path)))) {
  const text = await readFile(path, 'utf8');
  check(!sensitiveValues.some(value => text.includes(value)), `A configured backend secret value appears in ${relative(out, path)}; do not publish.`);
  check(!/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/.test(text), `A possible API token appears in ${relative(out, path)}; review before publishing.`);
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified static export: ${routes.length} required routes, ${exportedFiles.length} files, local assets/font, canonical DOCX, browser/backend separation, and configured-secret scan. Output: apps/web/out/.`);
}
