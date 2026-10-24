import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

interface UserRecord { username: string; salt: string; hash: string }
const users = new Map<string, UserRecord>();

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', config.secret).update(data).digest('base64url');

export function registerUser(username: string, password: string): boolean {
  const k = username.toLowerCase();
  if (users.has(k)) return false;
  const salt = randomBytes(16).toString('hex');
  users.set(k, { username, salt, hash: scryptSync(password, salt, 32).toString('hex') });
  return true;
}

export function checkCredentials(username: string, password: string): string | null {
  const u = users.get(username.toLowerCase());
  if (!u) return null;
  const hash = scryptSync(password, u.salt, 32);
  return timingSafeEqual(hash, Buffer.from(u.hash, 'hex')) ? u.username : null;
}

export function issueToken(username: string): string {
  const payload = b64(JSON.stringify({ u: username, exp: Date.now() + config.tokenTtlMs }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof u === 'string' && exp > Date.now() ? u : null;
  } catch { return null; }
}

export interface AuthedRequest extends Request { username?: string }

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const user = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return res.status(401).json({ error: 'Sesión no válida. Inicia sesión de nuevo.' });
  req.username = user;
  next();
}

/** Solo para pruebas. */
export function resetUsers() { users.clear(); }
