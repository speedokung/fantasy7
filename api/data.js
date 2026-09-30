import { redis, ID_RE, whoIs, readBody, adminCheck } from './_lib.js';

const COLS = ['players', 'weeks', 'matches', 'picks', 'config'];
const key = (c) => 'f7:' + c;

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
      const body = readBody(req);
      const { op, col, id } = body;
      let data = body.data;
      const me = whoIs(req);

      if (op === 'photo' || op === 'unphoto') {
        if (!ID_RE.test(String(id || ''))) return res.status(400).json({ error: 'bad_path' });
        if (op === 'unphoto') { await redis.hdel('f7:photos', id); return res.json({ ok: true }); }
        const ph = String(body.photo || '');
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ph) || ph.length > 400000)
          return res.status(400).json({ error: 'bad_photo' });
        await redis.hset('f7:photos', { [id]: ph });
        return res.json({ ok: true });
      }

      if (!COLS.includes(col) || !ID_RE.test(String(id || ''))) return res.status(400).json({ error: 'bad_path' });
      if (data !== undefined && (typeof data !== 'object' || data === null || Array.isArray(data) || JSON.stringify(data).length > 200000))
        return res.status(400).json({ error: 'bad_data' });

      // fantasy teams: only the logged-in owner may create, change or delete their own pick
      if (col === 'picks') {
        const owner = id.slice(id.indexOf('_') + 1);
        const ownerDoc = parse(await redis.hget(key('players'), owner));
        const demoOk = ownerDoc && ownerDoc.demo; // sample-data managers have no PIN
        if (!demoOk && owner !== me) return res.status(403).json({ error: 'not_you' });
        if (data) data.manager = owner;
        // no changes once the GW is locked (by the admin, or by its first recorded match)
        if (!demoOk) {
          const weekId = id.slice(0, id.indexOf('_'));
          const wk = parse(await redis.hget(key('weeks'), weekId));
          let locked = !!(wk && wk.locked);
          if (!locked) {
            const all = (await redis.hgetall(key('matches'))) || {};
            locked = Object.values(all).some((v) => { const m = parse(v); return m && m.weekId === weekId && m.played; });
          }
          if (locked) return res.status(403).json({ error: 'locked' });
        }
      }
      // locking / unlocking fantasy picks for a GW needs the admin PIN
      if (col === 'weeks' && data && 'locked' in data) {
        const cur = parse(await redis.hget(key('weeks'), id));
        if (!!data.locked !== !!(cur && cur.locked)) {
          const e = adminCheck(req.headers['x-admin']);
          if (e) return res.status(403).json({ error: e });
        }
      }
      // votes: a merge may only touch the caller's own vote; a full rewrite of a match clears votes
      if (col === 'matches') {
        if (op === 'merge' && data && data.votes) {
          if (!me || Object.keys(data.votes).some((k) => k !== me)) return res.status(403).json({ error: 'not_you' });
        }
        if (op === 'set' && data) data.votes = {};
      }

      if (op === 'set') {
        await redis.hset(key(col), { [id]: JSON.stringify(data) });
      } else if (op === 'merge') {
        const cur = await redis.hget(key(col), id);
        if (cur == null) return res.status(404).json({ error: 'not_found' });
        await redis.hset(key(col), { [id]: JSON.stringify(deepMerge(parse(cur), data)) });
      } else if (op === 'del') {
        await redis.hdel(key(col), id);
        if (col === 'players') { await redis.hdel('f7:pins', id); await redis.hdel('f7:photos', id); }
      } else {
        return res.status(400).json({ error: 'bad_op' });
      }
      const ver = await redis.incr('f7:ver');
      return res.json({ ok: true, ver });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String((e && e.message) || e) });
  }
}
