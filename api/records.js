// 最小化诊断版：不调 loadData，直接返回静态数据
// 如果这个能通 → 问题在 @vercel/blob / loadData
// 如果这个也崩 → 问题在模块加载 / 依赖

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // GET — 最小化测试
  if (method === 'GET') {
    return res.status(200).json([
      { name: '_test_', text: '诊断正常', day: 1, time: Date.now(), key: '_test__1' }
    ]);
  }

  // DELETE — 最小化测试
  if (method === 'DELETE') {
    return res.status(200).json({ success: true, test: true });
  }

  return res.status(405).json({ error: '方法不允许' });
}
