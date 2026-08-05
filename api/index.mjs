import { put, head, del as blobDel } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_BLOB_KEY = 'reading-data/data.json';
const SEED_DATA = path.join(process.cwd(), 'data.json');
const SEED_IMG_DIR = path.join(process.cwd(), 'data', 'images');

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function json(res, data, status = 200) {
  res.status(status).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data));
}

async function loadData() {
  try {
    const b = await head(DATA_BLOB_KEY);
    if (b) {
      const res = await fetch(b.url);
      if (res.ok) return await res.json();
    }
  } catch (err) {
    console.error('读取 Blob 数据失败:', err.message);
  }
  return { records: [], groups: [] };
}

async function saveData(data) {
  await put(DATA_BLOB_KEY, Buffer.from(JSON.stringify(data), 'utf8'), { access: 'private', contentType: 'application/json' });
}

async function seedIfEmpty() {
  try {
    const existing = await head(DATA_BLOB_KEY);
    if (existing) return;
  } catch (_) {}
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(SEED_DATA, 'utf8'));
  } catch (err) {
    console.error('读取种子 data.json 失败:', err.message);
    return;
  }
  if (fs.existsSync(SEED_IMG_DIR)) {
    for (const f of fs.readdirSync(SEED_IMG_DIR)) {
      try {
        const buf = fs.readFileSync(path.join(SEED_IMG_DIR, f));
        const ext = path.extname(f).slice(1) || 'png';
        const blob = await put(`reading-images/${f}`, buf, { access: 'public', contentType: `image/${ext}` });
        for (const r of (seed.records || [])) {
          if (r.image === `/media/${f}`) r.image = blob.url;
        }
      } catch (err) {
        console.error('上传图片失败', f, err.message);
      }
    }
  }
  await saveData(seed);
  console.log('已从种子初始化 Blob:', (seed.records || []).length, '条记录');
}

try { await seedIfEmpty(); } catch (err) { console.error('seedIfEmpty 异常:', err.message); }

function requireAdmin(req) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return { ok: false, status: 503, error: '服务器未配置管理密码' };
  if ((req.headers['x-admin-password'] || '') !== configured) return { ok: false, status: 401, error: '管理密码错误' };
  return { ok: true };
}

async function imageToUrl(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) return false;
  const ext = m[1].split('/')[1];
  const name = `reading-images/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const blob = await put(name, buffer, { access: 'public', contentType: m[1] });
  return blob.url;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(new Error('无效 JSON')); }
    });
    req.on('error', reject);
  });
}

// ── 路由分发 ──
export default async function handler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const method = (req.method || 'GET').toUpperCase();
  const path = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-password');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── GET /api/health ──
  if (path === '/api/health' && method === 'GET') {
    return json(res, { ok: true, aiEnabled: Boolean(process.env.AI_API_KEY), storage: 'vercel-blob' });
  }

  // ── GET /api/records ──
  if (path === '/api/records' && method === 'GET') {
    const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
    return json(res, records);
  }

  // ── GET /api/groups ──
  if (path === '/api/groups' && method === 'GET') {
    const data = await loadData();
    const groups = (data.groups || []).map(g => ({
      name: cleanText(g.name, 40),
      leader: cleanText(g.leader, 30),
      members: Array.isArray(g.members) ? g.members.map(m => cleanText(m, 30)).filter(Boolean) : []
    }));
    return json(res, groups);
  }

  // ── POST /api/checkin ──
  if (path === '/api/checkin' && method === 'POST') {
    const body = await parseBody(req);
    const name = cleanText(body.name, 30);
    const text = cleanText(body.text, 2000);
    const day = Number.parseInt(body.day, 10);
    let image = null;
    if (body.image) {
      const url = await imageToUrl(body.image);
      if (url === false) return json(res, { error: '图片超过 2MB' }, 400);
      if (url === null) return json(res, { error: '图片格式不支持' }, 400);
      image = url;
    }
    if (!name || !Number.isInteger(day) || day < 1 || day > 365) return json(res, { error: '姓名或学习天数无效' }, 400);
    if (!text && !image) return json(res, { error: '请填写心得或上传图片' }, 400);

    const data = await loadData();
    const key = `${name}_${day}`;
    const existing = data.records.find(r => r.key === key);
    const record = { key, name, day, text, image, feedback: existing?.feedback || '', ...(existing?.feedbackTime ? { feedbackTime: existing.feedbackTime } : {}), time: Date.now() };
    const index = data.records.findIndex(item => item.key === key);
    if (index >= 0) data.records[index] = record; else data.records.push(record);
    await saveData(data);
    return json(res, { success: true, record }, index >= 0 ? 200 : 201);
  }

  // ── POST /api/ai-feedback ──
  if (path === '/api/ai-feedback' && method === 'POST') {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return json(res, { error: 'AI 教练尚未由管理员配置' }, 503);
    const body = await parseBody(req);
    const text = cleanText(body.text, 2000);
    if (!text) return json(res, { error: '缺少读书心得' }, 400);
    const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'gpt-4.1-mini', temperature: 0.7, max_tokens: 220,
          messages: [
            { role: 'system', content: '你是温暖、具体的读书教练。用中文给出不超过120字的反馈：先肯定一个具体洞察，再追问一个可行动的问题。不要编造书中内容。' },
            { role: 'user', content: text }
          ]
        })
      });
      if (!response.ok) throw new Error(`上游服务返回 ${response.status}`);
      const payload = await response.json();
      const feedback = cleanText(payload.choices?.[0]?.message?.content, 600);
      if (!feedback) throw new Error('上游服务未返回内容');
      return json(res, { feedback });
    } catch (error) {
      console.error('AI 请求失败:', error.message);
      return json(res, { error: 'AI 教练暂时不可用，请稍后重试' }, 502);
    }
  }

  // ── DELETE /api/records/:name/:day ──
  if (path.startsWith('/api/records/') && method === 'DELETE') {
    const auth = requireAdmin(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);
    const parts = path.replace('/api/records/', '').split('/');
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

  // ── POST /api/reset ──
  if (path === '/api/reset' && method === 'POST') {
    const auth = requireAdmin(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);
    await saveData({ records: [] });
    return json(res, { success: true });
  }

  // ── GET /api/export ──
  if (path === '/api/export' && method === 'GET') {
    const auth = requireAdmin(req);
    if (!auth.ok) return json(res, { error: auth.error }, auth.status);
    const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
    res.setHeader('Content-Disposition', 'attachment; filename="reading-checkin-export.json"');
    return json(res, { version: 1, exportedAt: new Date().toISOString(), records });
  }

  // ── 404 ──
  return json(res, { error: 'API 不存在' }, 404);
}
