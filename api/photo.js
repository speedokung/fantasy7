import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

export default async function handler(req, res) {
  if (!redis) return res.status(500).end();
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_\-.:@+~]{1,120}$/.test(id)) return res.status(400).end();
  const v = await redis.hget('f7:photos', id);
  const m = typeof v === 'string' && v.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
  res.setHeader('Content-Type', m[1]);
  // the page adds ?v=<timestamp> whenever a photo changes, so each URL can be cached forever
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.status(200).send(Buffer.from(m[2], 'base64'));
}
