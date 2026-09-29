import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = url && token ? new Redis({ url, token }) : null;

const SECRET = process.env.TOKEN_SECRET || token || 'dev-secret';
export const ID_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}$/;

// a player's login token: HMAC of their id, so it can be checked without storing sessions
export const tokenFor = (pid) => crypto.createHmac('sha256', SECRET).update('tok:' + pid).digest('base64url');
export const pinHash = (pid, pin) => crypto.createHmac('sha256', SECRET).update('pin:' + pid + ':' + pin).digest('base64url');

export function whoIs(req) {
  const pid = String(req.headers['x-me'] || '');
  const tok = String(req.headers['x-tok'] || '');
  if (!ID_RE.test(pid) || !tok) return null;
  const want = tokenFor(pid);
  return tok.length === want.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(want)) ? pid : null;
}

export function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}
