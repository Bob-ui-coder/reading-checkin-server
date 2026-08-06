import { json, lazySeed } from '../_lib.mjs';

export default async function handler(req, res) {
  lazySeed();
  if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  return json(res, { ok: true, aiEnabled: Boolean(process.env.AI_API_KEY), storage: 'gist' });
}
