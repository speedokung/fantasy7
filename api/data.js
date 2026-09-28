import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const COLS = ['players', 'weeks', 'matches', 'picks', 'config'];
const key = (c) => 'f7:' + c;
const ID_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}$/;

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
function deepMerge(t, s) {
  for (const k in s) {
    const a = t[k], b = s[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) deepMerge(a, b);
    else t[k] = b;
  }
  return t;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!redis) return res.status(500).json({ error: 'no_db' });

  try {
    if (req.method === 'GET') {
      const ver = Number((await redis.get('f7:ver')) || 0);
      if (req.query.since !== undefined && Number(req.query.since) === ver) return res.json({ ver, same: true });
      const p = redis.pipeline();
      COLS.forEach((c) => p.hgetall(key(c)));
      const rows = await p.exec();
      const data = {};
      COLS.forEach((c, i) => {
        data[c] = {};
        for (const [id, v] of Object.entries(rows[i] || {})) data[c][id] = parse(v);
      });
      return res.json({ ver, data });
    }

    if (req.method === 'POST') {
      const pin = process.env.GROUP_PIN;
      if (pin && req.headers['x-pin'] !== pin) return res.status(401).json({ error: 'bad_pin' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { op, col, id, data } = body;
      if (!COLS.includes(col) || !ID_RE.test(String(id || ''))) return res.status(400).json({ error: 'bad_path' });
      if (data !== undefined && (typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 200000))
        return res.status(400).json({ error: 'bad_data' });

      if (op === 'set') {
        await redis.hset(key(col), { [id]: JSON.stringify(data) });
      } else if (op === 'merge') {
        const cur = await redis.hget(key(col), id);
        if (cur == null) return res.status(404).json({ error: 'not_found' });
        await redis.hset(key(col), { [id]: JSON.stringify(deepMerge(parse(cur), data)) });
      } else if (op === 'del') {
        await redis.hdel(key(col), id);
      } else {
        return res.status(400).json({ error: 'bad_op' });
      }
      const ver = await redis.incr('f7:ver');
      return res.json({ ok: true, ver });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
}
