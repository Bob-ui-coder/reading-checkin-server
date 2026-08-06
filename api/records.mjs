import { json, lazySeed, loadData, saveData, requireAdmin } from '../_lib.mjs';

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

  // GET /api/records —— 返回全部打卡记录（按时间倒序）
  if (method === 'GET') {
    try {
      const data = await loadData();
      const records = data.records.sort((a, b) => Number(b.time) - Number(a.time));
      return json(res, records);
    } catch (err) {
      return json(res, { error: '读取记录失败: ' + err.message }, 500);
    }
  }

  // DELETE /api/records/:name/:day —— 管理员删除
  if (method === 'DELETE') {
    const auth = requireAdmin(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);

    let name, day;
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean); // ['api','records',name,day]
      name = decodeURIComponent(parts[2] || '');
      day = parts[3];
    } catch (e) { /* ignore */ }
    // 兜底：也支持查询参数 ?name=&day=
    if (!name || !day) {
      const u = new URL(req.url, 'http://localhost');
      name = name || u.searchParams.get('name') || '';
      day = day || u.searchParams.get('day') || '';
    }
    if (!name || !day) return json(res, { error: '缺少 name 或 day 参数' }, 400);

    try {
      const data = await loadData();
      const key = `${name}_${day}`;
      const before = data.records.length;
      data.records = data.records.filter(r => r.key !== key);
      if (data.records.length === before) return json(res, { error: '未找到该记录' }, 404);
      await saveData(data);
      return json(res, { success: true, deleted: before - data.records.length });
    } catch (err) {
      return json(res, { error: '删除失败: ' + err.message }, 500);
    }
  }

  return json(res, { error: '方法不允许' }, 405);
}
