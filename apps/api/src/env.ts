export interface BackendEnv {
  databaseUrl: string;
  sessionSecret: string;
  appOrigins: string[];
  production: boolean;
  port: number;
  cookieSameSite: 'lax' | 'none' | 'strict';
  rebuildHook?: string;
}

export function readBackendEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  const sessionSecret = source.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32 || /replace-with|example|changeme/i.test(sessionSecret)) {
    throw new Error('SESSION_SECRET must be a securely generated secret of at least 32 characters.');
  }
  const databaseUrl = source.DATABASE_URL ?? '';
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must point to PostgreSQL.');
  const appOrigins = (source.APP_ORIGIN ?? 'http://localhost:3000').split(',').map(origin => {
    const value = new URL(origin.trim());
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('APP_ORIGIN must contain exact HTTP(S) origins.');
    return value.origin;
  });
  const production = source.NODE_ENV === 'production';
  const cookieSameSite = source.COOKIE_SAME_SITE ?? 'lax';
  if (!['lax', 'strict', 'none'].includes(cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.');
  if (cookieSameSite === 'none' && !production) throw new Error('Cross-site cookies require HTTPS production mode.');
  const port = Number(source.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
  if (source.STATIC_REBUILD_HOOK_URL) {
    const url = new URL(source.STATIC_REBUILD_HOOK_URL);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('STATIC_REBUILD_HOOK_URL must use HTTPS.');
  }
  return { databaseUrl, sessionSecret, appOrigins, production, port, cookieSameSite: cookieSameSite as BackendEnv['cookieSameSite'], rebuildHook: source.STATIC_REBUILD_HOOK_URL };
}
