import { redis, ID_RE, whoIs, readBody, adminCheck } from './_lib.js';
import { MATCH_OPS, matchOp } from './_match.js';

const COLS = ['players', 'weeks', 'matches', 'picks', 'config'];
const key = (c) => 'f7:' + c;

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const stripNames = (evs) => (evs || []).map((e) => { const { sLoan, aLoan, ...r } = e || {}; return r; });
function deepMerge(t, s) {
  for (const k in s) {
    const a = t[k], b = s[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a)) deepMerge(a, b);
    else t[k] = b;
  }
  return t;
}

async function write(req, res, body, me) {
  const { op, col, id } = body;
  let data = body.data;
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
      if (wk && wk.closed) locked = true;
      else if (wk && wk.unlocked) locked = false; // admin reopened fantasy picks
      else if (!locked) {
        const all = (await redis.hgetall(key('matches'))) || {};
        locked = Object.values(all).some((v) => { const m = parse(v); return m && m.weekId === weekId && (m.played || m.live); });
      }
      if (locked) return res.status(403).json({ error: 'locked' });
    }
  }
  // a closed GW is frozen: its matches and week record can't change (an admin can reopen it)
  if (col === 'weeks' && data && ('closed' in data || 'cfg' in data)) {
    const e = adminCheck(req.headers['x-admin']);
    if (e) return res.status(403).json({ error: e });
  } else if (col === 'weeks') {
    const cur = parse(await redis.hget(key('weeks'), id));
    if (cur && cur.closed) return res.status(403).json({ error: 'closed' });
  }
  if (col === 'matches') {
    const cur = parse(await redis.hget(key('matches'), id));
    const wid = (cur && cur.weekId) || (data && data.weekId);
    if (wid) {
      const wk = parse(await redis.hget(key('weeks'), wid));
      // borrowed-player names are stats only (no fantasy points), so they may still be filled in after closing
      const namesOnly = op === 'merge' && cur && data && Object.keys(data).length === 1 && Array.isArray(data.events) &&
        JSON.stringify(stripNames(cur.events)) === JSON.stringify(stripNames(data.events));
      if (wk && wk.closed && !namesOnly && op !== 'evNames') return res.status(403).json({ error: 'closed' });
    }
    // live recording: small targeted ops instead of rewriting the goal list
    if (MATCH_OPS.includes(op)) {
      const r = matchOp(cur, op, data, me, Date.now());
      if (r.error) return res.status(r.error === 'not_found' ? 404 : r.error === 'need_me' ? 403 : 409).json({ error: r.error, recorder: r.recorder || null });
      if (r.same) return res.json({ ok: true, same: true, ver: Number((await redis.get('f7:ver')) || 0) });
      await redis.hset(key('matches'), { [id]: JSON.stringify(r.doc) });
      const ver = await redis.incr('f7:ver');
      return res.json({ ok: true, ver });
    }
    // while a match is being recorded live, only the recorder may rewrite its result or goals
    if (cur && cur.live && cur.recorder && cur.recorder !== me && (op === 'set' || op === 'del' || (data && 'events' in data)))
      return res.status(409).json({ error: 'not_recorder', recorder: cur.recorder });
  }
  // per-GW positions can't be changed once the GW is locked (filling in missing ones is still allowed)
  if (col === 'weeks' && data && data.pos) {
    const cur = parse(await redis.hget(key('weeks'), id));
    const changed = cur && cur.pos && Object.keys(data.pos).some((k) => cur.pos[k] && cur.pos[k] !== data.pos[k]);
    if (changed) {
      let locked = !!cur.locked;
      if (!locked) {
        const all = (await redis.hgetall(key('matches'))) || {};
        locked = Object.values(all).some((v) => { const m = parse(v); return m && m.weekId === id && (m.played || m.live); });
      }
      if (locked) return res.status(403).json({ error: 'locked' });
    }
  }
  // check-in (who came this GW) is admin-only once the GW exists
  if (col === 'weeks' && data && 'attendees' in data) {
    const cur = parse(await redis.hget(key('weeks'), id));
    const norm = (x) => JSON.stringify([...(x || [])].sort());
    if (cur && norm(cur.attendees) !== norm(data.attendees)) {
      const e = adminCheck(req.headers['x-admin']);
      if (e) return res.status(403).json({ error: e });
    }
  }
  // locking / unlocking fantasy picks for a GW needs the admin PIN
  // scoring rules are admin-only
  if (col === 'config') {
    const e = adminCheck(req.headers['x-admin']);
    if (e) return res.status(403).json({ error: e });
  }
  if (col === 'weeks' && data && 'unlocked' in data) {
    const cur = parse(await redis.hget(key('weeks'), id));
    if (!!data.unlocked !== !!(cur && cur.unlocked)) {
      const e = adminCheck(req.headers['x-admin']);
      if (e) return res.status(403).json({ error: e });
    }
  }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one writer at a time per match, so a read-modify-write never loses someone else's change
async function withLock(id, fn) {
  const k = 'f7:lk:' + id;
  for (let i = 0; i < 40; i++) {
    if (await redis.set(k, '1', { nx: true, px: 4000 })) {
      try { return await fn(); } finally { await redis.del(k); }
    }
    await sleep(60 + Math.random() * 60);
  }
  const e = new Error('busy_lock'); e.status = 503; throw e;
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
      if (col === 'matches') return await withLock(id, () => write(req, res, body, me));
      return await write(req, res, body, me);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status((e && e.status) || 500).json({ error: (e && e.status) ? 'busy_lock' : 'server', detail: String((e && e.message) || e) });
  }
}
