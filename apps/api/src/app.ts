import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { z } from 'zod';
import { NewsInputSchema, EventInputSchema, TeamMemberInputSchema, LoginSchema, NewsSchema, EventSchema, TeamMemberSchema } from '@aet/contracts';
import { ApiError } from './errors.js';
import { hashPassword, verifyPassword, newSessionToken, sessionDigest, type RequireAdmin } from './auth.js';
import { readBackendEnv, type BackendEnv } from './env.js';
import { createPrismaRepository, type Repository, type Resource } from './repository.js';
import { RateLimiter } from './rate-limit.js';
import { configuredImageStorage, validateDecodedImage, type ImageStorage } from './storage.js';
import { registerAiRoutes } from './ai/routes.js';
import type { AiProvider } from './ai/provider.js';

export interface AppOptions {
  repository?: Repository;
  env?: BackendEnv;
  aiProvider?: AiProvider;
  storage?: ImageStorage;
  now?: () => number;
}

const resources = ['news', 'events', 'team'] as const;
const keySchema = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_-]+$/);
const inputSchemas = { news: NewsInputSchema, events: EventInputSchema, team: TeamMemberInputSchema };
const outputSchemas = { news: NewsSchema, events: EventSchema, team: TeamMemberSchema };

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? readBackendEnv();
  const repository = options.repository ?? await createPrismaRepository(env.databaseUrl);
  const storage = options.storage ?? configuredImageStorage();
  const now = options.now ?? Date.now;
  const limiter = new RateLimiter(now);
  const app = Fastify({
    logger: env.production ? {
      level: 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    } : false,
    // Only explicit diagnostic events are logged; URLs, bodies, and credentials stay out.
    disableRequestLogging: true,
    bodyLimit: 10 * 1024 * 1024,
    requestTimeout: 90_000,
    trustProxy: false,
  });
  const cookieName = env.production ? '__Host-aet_session' : 'aet_session';
  const cookieOptions = { httpOnly: true, secure: env.production, sameSite: env.cookieSameSite, path: '/', signed: true } as const;
  const dummyPasswordHash = await hashPassword(newSessionToken());
  app.decorateRequest('admin', null);
  await app.register(cookie, { secret: env.sessionSecret, hook: 'onRequest' });
  await app.register(cors, {
    origin(origin, done) {
      if (!origin) { done(null, false); return; }
      if (!env.appOrigins.includes(origin)) { done(new ApiError(403, 'ORIGIN_DENIED', 'Origin tidak diizinkan.'), false); return; }
      done(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-File-Name'],
    maxAge: 600,
  });
  for (const contentType of ['image/png', 'image/jpeg', 'image/webp']) {
    app.addContentTypeParser(contentType, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cache-Control', 'no-store');
    if (env.production) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (!origin || !env.appOrigins.includes(origin)) throw new ApiError(403, 'CSRF_ORIGIN', 'Permintaan harus berasal dari aplikasi yang diizinkan.');
    }
    // Use the matched route: Fastify accepts encoded static letters in URLs.
    // Raw request.url would let /auth/%6cogin evade the login-specific limit.
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    if (path === '/v1/auth/login') limiter.take(`login:${request.ip}`, 5, 60_000);
    else if (path === '/v1/chat') limiter.take(`chat:${request.ip}`, 30, 60_000);
    else if (path === '/v1/uploads' || path === '/v1/attachments/extract') limiter.take(`files:${request.ip}`, 10, 60_000);
    else if (path === '/v1/admin/ai/model-test') limiter.take(`model-test:${request.ip}`, 5, 60_000);
    else limiter.take(`api:${request.ip}`, 240, 60_000);
  });

  const requireAdmin: RequireAdmin = async request => {
    const signedCookie = request.cookies[cookieName];
    const decoded = signedCookie ? request.unsignCookie(signedCookie) : undefined;
    if (!decoded?.valid || !decoded.value) throw new ApiError(401, 'AUTH_REQUIRED', 'Silakan masuk sebagai administrator.');
    const admin = await repository.findSession(sessionDigest(decoded.value), new Date(now()));
    if (!admin) throw new ApiError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Silakan masuk kembali.');
    request.admin = admin;
  };
  app.decorate('requireAdmin', requireAdmin);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode === 429) reply.header('Retry-After', '60');
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Data tidak valid. Periksa kolom dan format yang dikirim.' } });
    const details = error as { code?: string; statusCode?: number };
    if (details.code === 'P2002') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Slug atau identitas sudah digunakan.' } });
    if (details.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan.' } });
    if (details.statusCode && details.statusCode >= 400 && details.statusCode < 500) return reply.status(details.statusCode).send({ error: { code: details.code ?? 'BAD_REQUEST', message: details.statusCode === 413 ? 'Berkas atau permintaan terlalu besar.' : 'Permintaan tidak valid.' } });
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Layanan mengalami kendala. Silakan coba lagi.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }));
  app.addHook('onClose', async () => { await repository.close?.(); });

  app.get('/health', async (_request, reply) => {
    try { await repository.ping(); return { status: 'ok', service: 'aet-api' }; }
    catch { return reply.status(503).send({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database belum tersedia.' } }); }
  });
  app.post('/v1/auth/login', async (request, reply) => {
    const { username, password } = LoginSchema.parse(request.body);
    const admin = await repository.findAdmin(username);
    const valid = await verifyPassword(password, admin?.passwordHash ?? dummyPasswordHash);
    if (!admin || !valid) throw new ApiError(401, 'LOGIN_FAILED', 'Nama pengguna atau kata sandi tidak sesuai.');
    const token = newSessionToken();
    await repository.createSession(sessionDigest(token), admin.id, new Date(now() + 24 * 60 * 60 * 1000));
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: 86_400 });
    return { user: { id: admin.id, username: admin.username } };
  });
  app.get('/v1/auth/me', { preHandler: requireAdmin }, request => ({ user: request.admin }));
  app.post('/v1/auth/logout', async (request, reply) => {
    const signedCookie = request.cookies[cookieName];
    const decoded = signedCookie ? request.unsignCookie(signedCookie) : undefined;
    if (decoded?.valid && decoded.value) await repository.deleteSession(sessionDigest(decoded.value));
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });

  const notifyRebuild = () => {
    if (!env.rebuildHook) return;
    void fetch(env.rebuildHook, { method: 'POST', signal: AbortSignal.timeout(5000), redirect: 'error' }).catch(() => undefined);
  };
  for (const resource of resources) {
    app.get(`/v1/${resource}`, async () => outputSchemas[resource].array().parse(await repository.list(resource)));
    if (resource !== 'team') app.get(`/v1/${resource}/:key`, async request => {
      const key = parseKey(request);
      const record = await repository.find(resource, key);
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Konten tidak tersedia atau belum diterbitkan.');
      return outputSchemas[resource].parse(record);
    });
    app.get(`/v1/admin/${resource}`, { preHandler: requireAdmin }, async () => outputSchemas[resource].array().parse(await repository.list(resource, true)));
    app.post(`/v1/admin/${resource}`, { preHandler: requireAdmin }, async (request, reply) => {
      const input = inputSchemas[resource].parse(request.body);
      checkEventDates(resource, input);
      const record = await repository.create(resource, input);
      notifyRebuild();
      return reply.status(201).send(outputSchemas[resource].parse(record));
    });
    app.patch(`/v1/admin/${resource}/:key`, { preHandler: requireAdmin }, async request => {
      const key = parseKey(request);
      const parsed = inputSchemas[resource].partial().strict().parse(request.body);
      // Zod defaults also run inside optional fields. PATCH only changes keys the client sent.
      const input = Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.prototype.hasOwnProperty.call(request.body, key)));
      if (!Object.keys(input).length) throw new ApiError(400, 'EMPTY_UPDATE', 'Tidak ada perubahan yang dikirim.');
      const existing = await repository.find(resource, key, true);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Data tidak ditemukan.');
      checkEventDates(resource, { ...existing, ...input });
      const record = await repository.update(resource, key, input);
      notifyRebuild();
      return outputSchemas[resource].parse(record);
    });
    app.delete(`/v1/admin/${resource}/:key`, { preHandler: requireAdmin }, async request => {
      const key = parseKey(request);
      if (!await repository.find(resource, key, true)) throw new ApiError(404, 'NOT_FOUND', 'Data tidak ditemukan.');
      await repository.delete(resource, key);
      notifyRebuild();
      return { ok: true };
    });
  }
  app.post('/v1/uploads', { preHandler: requireAdmin, bodyLimit: 5 * 1024 * 1024 }, async request => {
    if (!Buffer.isBuffer(request.body)) throw new ApiError(415, 'IMAGE_TYPE', 'Kirim isi berkas gambar dengan Content-Type yang sesuai.');
    const contentType = request.headers['content-type']?.split(';')[0] ?? '';
    const image = await validateDecodedImage(request.body, contentType);
    if (!storage) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Penyimpanan gambar belum dikonfigurasi. Gunakan URL gambar yang valid.');
    return { url: await storage.put(request.body, image.mimeType, image.extension) };
  });

  await registerAiRoutes(app, { provider: options.aiProvider, requireAdmin });
  return app;
}

function parseKey(request: FastifyRequest): string {
  return keySchema.parse((request.params as { key?: string }).key);
}

function checkEventDates(resource: Resource, input: Record<string, unknown>): void {
  if (resource === 'events' && typeof input.startDate === 'string' && typeof input.endDate === 'string' && Date.parse(input.endDate) < Date.parse(input.startDate)) {
    throw new ApiError(400, 'EVENT_DATES', 'Waktu selesai harus sesudah waktu mulai.');
  }
}
