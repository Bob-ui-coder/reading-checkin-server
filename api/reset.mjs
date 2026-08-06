import { json, lazySeed, saveData, requireAdmin } from '../_lib.mjs';

export default async function handler(req, res) {
  lazySeed();
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (method !== 'POST') return json(res, { error: '方法不允许' }, 405);

  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, { error: auth.error }, auth.status);

  await saveData({ records: [] });
  return json(res, { success: true });
}
