// Live-recording operations on one match document. Each op touches only what it needs,
// so two phones never overwrite each other's goals. Only the current recorder may change
// the goal list of a live match; anyone signed in can take over ("claim").
// Returns { doc } with the new document, { same: true } when nothing changes, or { error }.
export const MATCH_OPS = ['start', 'addEvent', 'rmEvent', 'endMatch', 'cancelLive', 'claim', 'evNames'];

const ownsLive = (cur, me) => !cur.recorder || cur.recorder === me;

export function matchOp(cur, op, data, me, now) {
  if (!cur) return { error: 'not_found' };
  data = data || {};
  const doc = JSON.parse(JSON.stringify(cur));
  const evs = Array.isArray(doc.events) ? doc.events : (doc.events = []);
  const find = () => {
    if (data.eid) return evs.findIndex((e) => e && e.eid === data.eid);
    const i = Number(data.i);
    return Number.isInteger(i) && evs[i] && !evs[i].eid ? i : -1;
  };

  if (op === 'evNames') {
    // borrowed-player names are stats only, so anyone may fill them in at any time
    const i = find();
    if (i < 0) return { error: 'gone' };
    for (const k of ['sLoan', 'aLoan']) {
      const o = data[k];
      if (o && typeof o === 'object' && (o.pid || o.name)) evs[i][k] = o.pid ? { pid: String(o.pid).slice(0, 120) } : { name: String(o.name).slice(0, 40) };
      else if (k in data) delete evs[i][k];
    }
    return { doc };
  }
  if (!me) return { error: 'need_me' };

  if (op === 'start') {
    if (doc.live) return doc.recorder === me ? { same: true } : { error: 'busy', recorder: doc.recorder || null };
    if (doc.played) return { error: 'played' };
    Object.assign(doc, {
      live: true, recorder: me, by: me, startedAt: now, events: [], votes: {},
      gk: data.gk && typeof data.gk === 'object' ? { a: data.gk.a || 'loan', b: data.gk.b || 'loan' } : { a: 'loan', b: 'loan' },
    });
    if (data.roster && typeof data.roster === 'object') doc.roster = data.roster;
    return { doc };
  }
  if (op === 'claim') {
    if (!doc.live) return { error: 'not_live' };
    if (doc.recorder === me) return { same: true };
    doc.recorder = me;
    return { doc };
  }
  if (op === 'endMatch') {
    if (!doc.live) return doc.played ? { same: true } : { error: 'not_live' };
    if (!ownsLive(doc, me)) return { error: 'not_recorder', recorder: doc.recorder };
    Object.assign(doc, { live: false, played: true, at: now, by: me, votes: {} });
    delete doc.recorder;
    if (!doc.roster && data.roster && typeof data.roster === 'object') doc.roster = data.roster;
    return { doc };
  }
  if (!doc.live) return { error: 'not_live' };
  if (!ownsLive(doc, me)) return { error: 'not_recorder', recorder: doc.recorder };

  if (op === 'addEvent') {
    const ev = data.ev;
    if (!ev || typeof ev !== 'object' || !ev.eid || !['goal', 'og'].includes(ev.type) || !['a', 'b'].includes(ev.side)) return { error: 'bad_data' };
    if (evs.some((e) => e && e.eid === ev.eid)) return { same: true };
    evs.push(ev);
    return { doc };
  }
  if (op === 'rmEvent') {
    const i = find();
    if (i < 0) return { same: true };
    evs.splice(i, 1);
    return { doc };
  }
  if (op === 'cancelLive') {
    Object.assign(doc, { live: false, events: [], startedAt: null });
    delete doc.recorder;
    return { doc };
  }
  return { error: 'bad_op' };
}
