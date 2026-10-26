import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

const scrypt = promisify(scryptCallback);
export type AdminIdentity = { id: string; username: string };
export type RequireAdmin = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw new Error('Password must have 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, encoded] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !encoded || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function newSessionToken(): string { return randomBytes(32).toString('base64url'); }
export function sessionDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }

declare module 'fastify' {
  interface FastifyRequest { admin: AdminIdentity | null }
  interface FastifyInstance { requireAdmin: RequireAdmin }
}
