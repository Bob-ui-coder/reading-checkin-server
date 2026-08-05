import { json, lazySeed, loadData, requireAdmin } from '../_lib.mjs';

export default async function handler(req, res) {
  lazySeed();
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (method !== 'GET') return json(res, { error: '方法不允许' }, 405);

  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, { error: auth.error }, auth.status);

  const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
  res.setHeader('Content-Disposition', 'attachment; filename="reading-checkin-export.json"');
  return json(res, { version: 1, exportedAt: new Date().toISOString(), records });
}
