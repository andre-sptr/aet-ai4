import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { manifestFromPublicRows, projectRoot, saveManifest } from './route-manifest.js';
import { readPublicCollection } from './fetch-routes.js';

try {
  let news: unknown;
  let events: unknown;
  if (process.argv.includes('--from-seed')) {
    const seed = JSON.parse(await readFile(resolve(projectRoot, 'data/legacy-content.json'), 'utf8')) as {
      news: { published: boolean }[];
      events: { published: boolean }[];
    };
    if (!Array.isArray(seed.news) || !Array.isArray(seed.events)) throw new Error('Invalid audited seed data.');
    news = seed.news.filter(row => row.published === true);
    events = seed.events.filter(row => row.published === true);
    console.log('Explicit offline route source: audited legacy seed. Current CMS changes are not included.');
  } else {
    const base = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('NEXT_PUBLIC_API_BASE_URL must be an HTTP(S) API base URL without credentials, query, or fragment.');
    }
    [news, events] = await Promise.all([readPublicCollection(base, '/v1/news'), readPublicCollection(base, '/v1/events')]);
  }
  const manifest = manifestFromPublicRows(news, events);
  await saveManifest(manifest);
  console.log(`Static route manifest saved: ${manifest.news.length} news, ${manifest.events.length} events. No article content is embedded.`);
} catch (error) {
  console.error(`Static route synchronization failed: ${error instanceof Error ? error.message : 'unknown error'}\nStart the separately deployed API and check NEXT_PUBLIC_API_BASE_URL, then run npm run sync:routes. For a deliberate offline seed-only build use npm run sync:routes -- --from-seed. No fallback manifest was invented.`);
  process.exitCode = 1;
}
