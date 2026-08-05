// 纯 Gist API 存储 —— 不依赖 @vercel/blob / KV / 任何 Vercel 扩展
// 读记录：公开 Gist raw（无需认证，国内走 jsDelivr 改写图片域名）
// 读分组：仓库静态 data.json（含组长/成员，只读）
// 写：GitHub Gist API（需 GITHUB_TOKEN 环境变量，仅打卡/删除/重置时用）

const GIST_ID = process.env.GIST_ID || '9118572982a150ace89f2ba81ecb7999';
const GIST_RAW = `https://gist.githubusercontent.com/Bob-ui-coder/${GIST_ID}/raw/data.json`;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO_DATA_URL = 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data.json';

export function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function json(res, data, status = 200) {
  res.status(status).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data));
}

// 兼容旧调用：Gist 即实时数据源，无需种子逻辑
export function lazySeed() {}

// 把图片地址改写为国内更快的 jsDelivr CDN
function rewriteImage(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(
      'https://raw.githubusercontent.com/Bob-ui-coder/reading-checkin/main/docs/images/',
      'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin@main/docs/images/'
    )
    .replace(
      '/media/',
      'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data/images/'
    );
}

export async function loadData() {
  let records = [];
  try {
    const res = await fetch(GIST_RAW, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Gist raw HTTP ${res.status}`);
    const d = await res.json();
    records = Array.isArray(d.records) ? d.records : [];
  } catch (err) {
    console.error('loadData(records) 失败:', err.message);
  }

  let groups = [];
  try {
    const res = await fetch(REPO_DATA_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const d = await res.json();
      groups = Array.isArray(d.groups) ? d.groups : [];
    }
  } catch (err) {
    console.error('loadData(groups) 失败:', err.message);
  }

  for (const r of records) {
    if (r && typeof r.image === 'string') r.image = rewriteImage(r.image);
  }
  return { records, groups };
}

export async function saveData(data) {
  if (!GH_TOKEN) throw new Error('未配置 GITHUB_TOKEN，无法写入');
  const res = await fetch(GIST_API, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'reading-checkin'
    },
    body: JSON.stringify({
      description: '读书打卡数据',
      files: { 'data.json': { content: JSON.stringify(data) } }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gist 写入 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

export function requireAdmin(req) {
  const c = process.env.ADMIN_PASSWORD;
  if (!c) return { ok: false, status: 503, error: '服务器未配置管理密码' };
  if ((req.headers['x-admin-password'] || '') !== c) return { ok: false, status: 401, error: '管理密码错误' };
  return { ok: true };
}

// 处理打卡图片：base64 直接存；URL 直接存；非图片返回 null；超 2MB 返回 false
export async function imageToUrl(input) {
  if (!input || typeof input !== 'string') return null;
  if (input.startsWith('data:')) {
    const comma = input.indexOf(',');
    if (comma <= 0) return null;
    if (!/image\//.test(input.slice(0, comma))) return null;
    const bytes = Math.ceil((input.slice(comma + 1).length * 3) / 4);
    if (bytes > 2 * 1024 * 1024) return false;
    return input;
  }
  if (/^https?:\/\//.test(input)) return input;
  return null;
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { reject(new Error('无效 JSON')); }
    });
    req.on('error', reject);
  });
}
