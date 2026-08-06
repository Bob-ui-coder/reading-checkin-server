// === 公共工具函数 ===
const GIST_ID = process.env.GIST_ID || '9118572982a150ace89f2ba81ecb7999';
const GIST_RAW = `https://gist.githubusercontent.com/Bob-ui-coder/${GIST_ID}/raw/data.json`;
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO_DATA_URL = 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data.json';
function cleanText(v, m) { return typeof v === 'string' ? v.trim().slice(0, m) : ''; }
function json(res, data, s = 200) { res.status(s).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data)); }
function rewriteImage(url) { if (typeof url !== 'string') return url; return url.replace('https://raw.githubusercontent.com/Bob-ui-coder/reading-checkin/main/docs/images/', 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin@main/docs/images/').replace('/media/', 'https://cdn.jsdelivr.net/gh/Bob-ui-coder/reading-checkin-server@main/data/images/'); }
async function loadData() { let records = [], groups = []; try { const r = await fetch(GIST_RAW, { headers: { Accept: 'application/json' } }); if (r.ok) { const d = await r.json(); records = Array.isArray(d.records) ? d.records : []; } } catch (e) {} try { const r = await fetch(REPO_DATA_URL, { headers: { Accept: 'application/json' } }); if (r.ok) { const d = await r.json(); groups = Array.isArray(d.groups) ? d.groups : []; } } catch (e) {} for (const r of records) { if (r && typeof r.image === 'string') r.image = rewriteImage(r.image); } return { records, groups }; }
async function saveData(data) { if (!GH_TOKEN) throw new Error('未配置 GITHUB_TOKEN，无法写入'); const r = await fetch(GIST_API, { method: 'PATCH', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'reading-checkin' }, body: JSON.stringify({ description: '读书打卡数据', files: { 'data.json': { content: JSON.stringify(data) } } }) }); if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Gist 写入 HTTP ${r.status}: ${t.slice(0, 200)}`); } }
async function imageToUrl(input) { if (!input || typeof input !== 'string') return null; if (input.startsWith('data:')) { const c = input.indexOf(','); if (c <= 0) return null; if (!/image\//.test(input.slice(0, c))) return null; if (Math.ceil((input.slice(c + 1).length * 3) / 4) > 2 * 1024 * 1024) return false; return input; } if (/^https?:\/\//.test(input)) return input; return null; }
function parseBody(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c.toString(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(new Error('无效 JSON')); } }); req.on('error', reject); }); }

// === checkin ===
export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (method !== 'POST') return json(res, { error: '方法不允许' }, 405);
  const body = await parseBody(req);
  const name = cleanText(body.name, 30), text = cleanText(body.text, 2000), day = Number.parseInt(body.day, 10);
  let image = null;
  if (body.image) { const url = await imageToUrl(body.image); if (url === false) return json(res, { error: '图片超过 2MB' }, 400); if (url === null) return json(res, { error: '图片格式不支持' }, 400); image = url; }
  if (!name || !Number.isInteger(day) || day < 1 || day > 365) return json(res, { error: '姓名或学习天数无效' }, 400);
  if (!text && !image) return json(res, { error: '请填写心得或上传图片' }, 400);
  const data = await loadData(), key = `${name}_${day}`;
  const existing = data.records.find(r => r.key === key);
  const record = { key, name, day, text, image, feedback: existing?.feedback || '', ...(existing?.feedbackTime ? { feedbackTime: existing.feedbackTime } : {}), time: Date.now() };
  const idx = data.records.findIndex(item => item.key === key);
  if (idx >= 0) data.records[idx] = record; else data.records.push(record);
  await saveData(data);
  return json(res, { success: true, record }, idx >= 0 ? 200 : 201);
}
