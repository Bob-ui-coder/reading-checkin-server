import { json, lazySeed, loadData, saveData, requireAdmin, cleanText } from '../_lib.mjs';
import { del as blobDel } from '@vercel/blob';

export default async function handler(req, res) {
  lazySeed();
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // GET /api/records
  if (method === 'GET') {
    const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
    return json(res, records);
  }

  // DELETE /api/records/:name/:day
  if (method === 'DELETE') {
    const auth = requireAdmin(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);
    // Vercel passes query params; path is /api/records
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const parts = url.pathname.replace('/api/records/', '').split('/').filter(Boolean);
    const key = `${cleanText(parts[0], 30)}_${Number.parseInt(parts[1], 10)}`;
    const data = await loadData();
    const before = data.records.length;
    const removed = data.records.find(r => r.key === key);
    data.records = data.records.filter(r => r.key !== key);
    if (before === data.records.length) return json(res, { error: '记录不存在' }, 404);
    await saveData(data);
    if (removed?.image?.includes('blob.vercel-storage.com')) {
      try { await blobDel(removed.image); } catch (e) { console.error('删除 Blob 图片失败:', e.message); }
    }
    return json(res, { success: true });
  }

  return json(res, { error: '方法不允许' }, 405);
}
