import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface RouteManifest {
  news: { slug: string }[];
  events: { id: string }[];
}

function routeKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value)) {
    throw new Error(`Invalid ${label}; expected a bounded URL path segment without slashes.`);
  }
  return value;
}

function rows(value: unknown, field: 'slug' | 'id', label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
  const keys = value.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error(`${label} contains an invalid record.`);
    return routeKey((row as Record<string, unknown>)[field], `${label}.${field}`);
  });
  if (new Set(keys).size !== keys.length) throw new Error(`${label} contains duplicate route keys.`);
  return keys.sort();
}

export function manifestFromPublicRows(news: unknown, events: unknown): RouteManifest {
  return {
    news: rows(news, 'slug', 'Published news').map(slug => ({ slug })),
    events: rows(events, 'id', 'Public events').map(id => ({ id })),
  };
}

export function validateManifest(value: unknown): RouteManifest {
  if (!value || typeof value !== 'object') throw new Error('Static route manifest must be an object.');
  const manifest = value as Record<string, unknown>;
  if (Object.keys(manifest).some(key => key !== 'news' && key !== 'events')) {
    throw new Error('Static route manifest may contain only news and events route keys, not content.');
  }
  for (const [collection, field] of [['news', 'slug'], ['events', 'id']] as const) {
    if (Array.isArray(manifest[collection])) {
      for (const row of manifest[collection]) {
        if (!row || typeof row !== 'object' || Object.keys(row).some(key => key !== field)) {
          throw new Error('Static route entries may contain only their public route key.');
        }
      }
    }
  }
  return manifestFromPublicRows(manifest.news, manifest.events);
}

export async function loadManifest(path = resolve(projectRoot, 'data/routes.json')): Promise<RouteManifest> {
  try {
    return validateManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    throw new Error(`Static routes are unavailable or invalid at ${path}. Start the API and run npm run sync:routes before building.`, { cause: error });
  }
}

export async function saveManifest(manifest: RouteManifest, path = resolve(projectRoot, 'data/routes.json')): Promise<void> {
  const checked = validateManifest(manifest);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
}
