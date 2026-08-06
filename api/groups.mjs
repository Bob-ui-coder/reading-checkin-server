// === 公共工具函数 ===
const GIST_ID = process.env.GIST_ID || '9118572982a150ace89f2ba81ecb7999';
const GIST_RAW = `https://gist.githubusercontent.com/Bob-ui-coder/${GIST_ID}/raw/data.json`;
const REPO_DATA_URL = 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data.json';

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function json(res, data, status = 200) {
  res.status(status).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data));
}
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
    if (!res.ok) throw new Error(`Gist raw HTTP ${res.status}`);
    const d = await res.json();
    records = Array.isArray(d.records) ? d.records : [];
  } catch (err) { console.error('loadData(records) 失败:', err.message); }
  let groups = [];
  try {
    const res = await fetch(REPO_DATA_URL, { headers: { Accept: 'application/json' } });
    if (res.ok) { const d = await res.json(); groups = Array.isArray(d.groups) ? d.groups : []; }
  } catch (err) { console.error('loadData(groups) 失败:', err.message); }
  for (const r of records) { if (r && typeof r.image === 'string') r.image = rewriteImage(r.image); }
  return { records, groups };
}

// === groups ===
export default async function handler(req, res) {
  if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  const data = await loadData();
  const groups = (data.groups || []).map(g => ({
    name: cleanText(g.name, 40),
    leader: cleanText(g.leader, 30),
    members: Array.isArray(g.members) ? g.members.map(m => cleanText(m, 30)).filter(Boolean) : []
  }));
  return json(res, groups);
}
