const GIST_ID = process.env.GIST_ID || '9118572982a150ace89f2ba81ecb7999';
const GIST_RAW = `https://gist.githubusercontent.com/Bob-ui-coder/${GIST_ID}/raw/data.json`;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO_DATA_URL = 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data.json';

function rewriteImage(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace('https://raw.githubusercontent.com/Bob-ui-coder/reading-checkin/main/docs/images/', 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin@main/docs/images/')
    .replace('/media/', 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data/images/');
}

async function loadData() {
  let records = [];
  try {
    const res = await fetch(GIST_RAW, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      records = Array.isArray(d.records) ? d.records : [];
    }
  } catch (e) { console.error('loadData(records):', e.message); }
  let groups = [];
  try {
    const res = await fetch(REPO_DATA_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      groups = Array.isArray(d.groups) ? d.groups : [];
    }
  } catch (e) { console.error('loadData(groups):', e.message); }
  for (const r of records) {
    if (r && typeof r.image === 'string') r.image = rewriteImage(r.image);
  }
  return { records, groups };
}

async function saveData(data) {
  if (!GH_TOKEN) throw new Error('未配置 GITHUB_TOKEN，无法写入');
  const res = await fetch(GIST_API, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'reading-checkin' },
    body: JSON.stringify({ description: '读书打卡数据', files: { 'data.json': { content: JSON.stringify(data) } } })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gist 写入 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

function requireAdmin(req) {
  const c = process.env.ADMIN_PASSWORD;
  if (!c) return { ok: false, status: 503, error: '服务器未配置管理密码' };
  if ((req.headers.get('x-admin-password') || '') !== c) return { ok: false, status: 401, error: '管理密码错误' };
  return { ok: true };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

export default {
  async fetch(req) {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'x-admin-password' }
      });
    }

    if (method === 'GET') {
      try {
        const data = await loadData();
        return json(data.records.sort((a, b) => Number(b.time) - Number(a.time)));
      } catch (err) {
        return json({ error: '读取记录失败: ' + err.message }, 500);
      }
    }

    if (method === 'DELETE') {
      const auth = requireAdmin(req);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      let name, day;
      try {
        const u = new URL(req.url);
        const parts = u.pathname.split('/').filter(Boolean);
        name = decodeURIComponent(parts[2] || '');
        day = parts[3];
      } catch (e) {}
      if (!name || !day) {
        try {
          const u = new URL(req.url);
          name = name || u.searchParams.get('name') || '';
          day = day || u.searchParams.get('day') || '';
        } catch (e) {}
      }
      if (!name || !day) return json({ error: '缺少 name 或 day 参数' }, 400);
      try {
        const data = await loadData();
        const key = `${name}_${day}`;
        const before = data.records.length;
        data.records = data.records.filter(r => r.key !== key);
        if (data.records.length === before) return json({ error: '未找到该记录' }, 404);
        await saveData(data);
        return json({ success: true, deleted: before - data.records.length });
      } catch (err) {
        return json({ error: '删除失败: ' + err.message }, 500);
      }
    }

    return json({ error: '方法不允许' }, 405);
  }
};
