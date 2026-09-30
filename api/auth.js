import { redis, ID_RE, tokenFor, pinHash, readBody, adminCheck } from './_lib.js';

const PIN_RE = /^\d{4,6}$/;
const MAX_TRIES = 8; // wrong PINs allowed per 15 minutes, per player

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!redis) return res.status(500).json({ error: 'no_db' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { op, pid, pin, admin } = readBody(req);
  if (op === 'admin') {
    const e = adminCheck(admin);
    return e ? res.status(e === 'no_admin_pin' ? 403 : 401).json({ error: e }) : res.json({ ok: true });
  }
  if (!ID_RE.test(String(pid || ''))) return res.status(400).json({ error: 'bad_pid' });

  const exists = await redis.hexists('f7:players', pid);
  if (!exists) return res.status(404).json({ error: 'no_player' });
  const stored = await redis.hget('f7:pins', pid);

  if (op === 'status') return res.json({ hasPin: !!stored });

  if (op === 'claim') {
    if (stored) return res.status(409).json({ error: 'has_pin' });
    if (!PIN_RE.test(String(pin || ''))) return res.status(400).json({ error: 'bad_pin_format' });
    await redis.hset('f7:pins', { [pid]: pinHash(pid, pin) });
    return res.json({ token: tokenFor(pid) });
  }

  if (op === 'login') {
    if (!stored) return res.status(409).json({ error: 'no_pin' });
    const k = 'f7:tries:' + pid;
    const tries = Number((await redis.get(k)) || 0);
    if (tries >= MAX_TRIES) return res.status(429).json({ error: 'too_many' });
    if (pinHash(pid, String(pin || '')) !== stored) {
      await redis.incr(k); await redis.expire(k, 900);
      return res.status(401).json({ error: 'wrong_pin', left: MAX_TRIES - tries - 1 });
    }
    await redis.del(k);
    return res.json({ token: tokenFor(pid) });
  }

  if (op === 'reset') {
    const e = adminCheck(admin);
    if (e === 'no_admin_pin') return res.status(403).json({ error: e });
    if (e) return res.status(401).json({ error: 'wrong_admin' });
    await redis.hdel('f7:pins', pid);
    await redis.del('f7:tries:' + pid);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'bad_op' });
}
