import express from 'express';
import { put, head, del as blobDel } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(process.cwd(), 'public'), { etag: true, maxAge: '1h' }));

const DATA_BLOB_KEY = 'reading-data/data.json';
const SEED_DATA = path.join(process.cwd(), 'data.json');
const SEED_IMG_DIR = path.join(process.cwd(), 'data', 'images');

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// ── 纯 Blob 存储：数据 JSON 当文件存 ──

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
  const body = JSON.stringify(data);
  const buf = Buffer.from(body, 'utf8');
  await put(DATA_BLOB_KEY, buf, { access: 'private', contentType: 'application/json' });
}

// 首次冷启动：若 Blob 里没有数据，从仓库内置 data.json 初始化，并把 data/images 上传到 Blob
async function seedIfEmpty() {
  try {
    const existing = await head(DATA_BLOB_KEY);
    if (existing) {
      console.log('Blob 已有数据，跳过种子');
      return;
    }
  } catch (err) {
    // 不存在 → 需要种子
  }
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(SEED_DATA, 'utf8'));
  } catch (err) {
    console.error('读取种子 data.json 失败:', err.message);
    return;
  }
  // 上传历史图片到 Blob
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

try {
  await seedIfEmpty();
} catch (err) {
  console.error('seedIfEmpty 异常:', err.message);
}

function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return res.status(503).json({ error: '服务器未配置管理密码' });
  if (req.get('x-admin-password') !== configured) return res.status(401).json({ error: '管理密码错误' });
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiEnabled: Boolean(process.env.AI_API_KEY), storage: 'vercel-blob' });
});

app.get('/api/records', async (req, res) => {
  const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
  res.json(records);
});

app.get('/api/groups', async (req, res) => {
  const groups = (await loadData()).groups.map((group) => ({
    name: cleanText(group.name, 40),
    leader: cleanText(group.leader, 30),
    members: Array.isArray(group.members) ? group.members.map((member) => cleanText(member, 30)).filter(Boolean) : []
  }));
  res.json(groups);
});

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

app.post('/api/checkin', async (req, res) => {
  const name = cleanText(req.body.name, 30);
  const text = cleanText(req.body.text, 2000);
  const day = Number.parseInt(req.body.day, 10);
  let image = null;
  if (req.body.image) {
    const url = await imageToUrl(req.body.image);
    if (url === false) return res.status(400).json({ error: '图片超过 2MB' });
    if (url === null) return res.status(400).json({ error: '图片格式不支持' });
    image = url;
  }
  if (!name || !Number.isInteger(day) || day < 1 || day > 365) return res.status(400).json({ error: '姓名或学习天数无效' });
  if (!text && !image) return res.status(400).json({ error: '请填写心得或上传图片' });

  const data = await loadData();
  const key = `${name}_${day}`;
  const existing = data.records.find((record) => record.key === key);
  const record = {
    key, name, day, text, image,
    feedback: existing?.feedback || '',
    ...(existing?.feedbackTime ? { feedbackTime: existing.feedbackTime } : {}),
    time: Date.now()
  };
  const index = data.records.findIndex((item) => item.key === key);
  if (index >= 0) data.records[index] = record;
  else data.records.push(record);
  await saveData(data);
  res.status(index >= 0 ? 200 : 201).json({ success: true, record });
});

app.post('/api/ai-feedback', async (req, res) => {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI 教练尚未由管理员配置' });
  const text = cleanText(req.body.text, 2000);
  if (!text) return res.status(400).json({ error: '缺少读书心得' });
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4.1-mini',
        temperature: 0.7,
        max_tokens: 220,
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
    res.json({ feedback });
  } catch (error) {
    console.error('AI 请求失败:', error.message);
    res.status(502).json({ error: 'AI 教练暂时不可用，请稍后重试' });
  }
});

app.delete('/api/records/:name/:day', requireAdmin, async (req, res) => {
  const key = `${cleanText(req.params.name, 30)}_${Number.parseInt(req.params.day, 10)}`;
  const data = await loadData();
  const before = data.records.length;
  const removed = data.records.find((r) => r.key === key);
  data.records = data.records.filter((record) => record.key !== key);
  if (before === data.records.length) return res.status(404).json({ error: '记录不存在' });
  await saveData(data);
  if (removed && typeof removed.image === 'string' && removed.image.includes('blob.vercel-storage.com')) {
    try { await blobDel(removed.image); } catch (e) { console.error('删除 Blob 图片失败:', e.message); }
  }
  res.json({ success: true });
});

app.post('/api/reset', requireAdmin, async (req, res) => {
  await saveData({ records: [] });
  res.json({ success: true });
});

app.get('/api/export', requireAdmin, async (req, res) => {
  const records = (await loadData()).records.sort((a, b) => Number(b.time) - Number(a.time));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reading-checkin-export.json"');
  res.send(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API 不存在' }));
app.get('*', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')));

export default app;
