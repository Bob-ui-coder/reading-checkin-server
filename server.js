const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const SAMPLE_FILE = path.join(__dirname, 'sample-data.json');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'data', 'images');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));
app.use('/media', express.static(MEDIA_DIR, { dotfiles: 'deny', index: false, fallthrough: false }));

function normalizeData(value) {
  const records = Array.isArray(value) ? value : value && Array.isArray(value.records) ? value.records : [];
  const groups = value && Array.isArray(value.groups) ? value.groups : [];
  return { records, groups };
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    return normalizeData(JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')));
  } catch (error) {
    console.error('读取数据失败:', error.message);
    return { records: [], groups: [] };
  }
}

function saveData(data) {
  const directory = path.dirname(DATA_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporary, DATA_FILE);
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// 首次部署时把仓库内的种子数据(data.json + data/images)拷贝到持久盘(DATA_FILE/MEDIA_DIR)。
// 之后运行时读写都走持久盘，避免 Render 等 ephemeral 文件系统重启后丢失数据。
function seedIfEmpty() {
  const seedFile = path.join(__dirname, 'data.json');
  const seedImgDir = path.join(__dirname, 'data', 'images');
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE) && fs.existsSync(seedFile)) {
      fs.copyFileSync(seedFile, DATA_FILE);
      console.log('已从仓库种子初始化 DATA_FILE:', DATA_FILE);
    }
    if (fs.existsSync(seedImgDir) && path.resolve(seedImgDir) !== path.resolve(MEDIA_DIR)) {
      for (const f of fs.readdirSync(seedImgDir)) {
        const dst = path.join(MEDIA_DIR, f);
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(seedImgDir, f), dst);
      }
      console.log('已同步种子图片到 MEDIA_DIR:', MEDIA_DIR);
    }
  } catch (err) {
    console.error('种子初始化失败(可忽略，若持久盘已含数据):', err.message);
  }
}

function validImage(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) return false;
  return Buffer.byteLength(value, 'utf8') <= MAX_IMAGE_BYTES * 1.4 ? value : false;
}

function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return res.status(503).json({ error: '服务器未配置管理密码' });
  if (req.get('x-admin-password') !== configured) return res.status(401).json({ error: '管理密码错误' });
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiEnabled: Boolean(process.env.AI_API_KEY), storage: path.basename(DATA_FILE) });
});

app.get('/api/records', (req, res) => {
  const records = loadData().records.sort((a, b) => Number(b.time) - Number(a.time));
  res.json(records);
});

app.get('/api/groups', (req, res) => {
  const groups = loadData().groups.map((group) => ({
    name: cleanText(group.name, 40),
    leader: cleanText(group.leader, 30),
    members: Array.isArray(group.members) ? group.members.map((member) => cleanText(member, 30)).filter(Boolean) : []
  }));
  res.json(groups);
});

app.post('/api/checkin', (req, res) => {
  const name = cleanText(req.body.name, 30);
  const text = cleanText(req.body.text, 2000);
  const day = Number.parseInt(req.body.day, 10);
  const image = validImage(req.body.image);
  if (!name || !Number.isInteger(day) || day < 1 || day > 365) return res.status(400).json({ error: '姓名或学习天数无效' });
  if (!text && !image) return res.status(400).json({ error: '请填写心得或上传图片' });
  if (image === false) return res.status(400).json({ error: '图片格式不支持或超过 2MB' });

  const data = loadData();
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
  saveData(data);
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

app.delete('/api/records/:name/:day', requireAdmin, (req, res) => {
  const key = `${cleanText(req.params.name, 30)}_${Number.parseInt(req.params.day, 10)}`;
  const data = loadData();
  const before = data.records.length;
  data.records = data.records.filter((record) => record.key !== key);
  if (before === data.records.length) return res.status(404).json({ error: '记录不存在' });
  saveData(data);
  res.json({ success: true });
});

app.post('/api/reset', requireAdmin, (req, res) => {
  saveData({ records: [] });
  res.json({ success: true });
});

app.get('/api/export', requireAdmin, (req, res) => {
  const records = loadData().records.sort((a, b) => Number(b.time) - Number(a.time));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reading-checkin-export.json"');
  res.send(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API 不存在' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  seedIfEmpty();
  app.listen(PORT, () => console.log(`读书打卡已启动: http://localhost:${PORT}`));
}

module.exports = app;
