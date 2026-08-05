import { put, head, del as blobDel } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const DATA_BLOB_KEY = 'reading-data/data.json';
const SEED_DATA = path.join(process.cwd(), 'data.json');
const SEED_IMG_DIR = path.join(process.cwd(), 'data', 'images');

let _seeded = false;
let _seeding = null;

export function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function json(res, data, status = 200) {
  res.status(status).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data));
}

export async function loadData() {
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

export async function saveData(data) {
  await put(DATA_BLOB_KEY, Buffer.from(JSON.stringify(data), 'utf8'), { access: 'private', contentType: 'application/json' });
}

export function lazySeed() {
  if (_seeded || _seeding) return;
  _seeding = (async () => {
    try {
      try { const e = await head(DATA_BLOB_KEY); if (e) { _seeded = true; return; } } catch (_) {}
      let seed;
      try { seed = JSON.parse(fs.readFileSync(SEED_DATA, 'utf8')); } catch (err) { console.error('读取种子 data.json 失败:', err.message); return; }
      if (fs.existsSync(SEED_IMG_DIR)) {
        for (const f of fs.readdirSync(SEED_IMG_DIR)) {
          try {
            const buf = fs.readFileSync(path.join(SEED_IMG_DIR, f));
            const ext = path.extname(f).slice(1) || 'png';
            const blob = await put(`reading-images/${f}`, buf, { access: 'public', contentType: `image/${ext}` });
            for (const r of (seed.records || [])) { if (r.image === `/media/${f}`) r.image = blob.url; }
          } catch (err) { console.error('上传图片失败', f, err.message); }
        }
      }
      await saveData(seed);
      console.log('✅ 种子初始化完成:', (seed.records || []).length, '条记录');
    } catch (err) { console.error('❌ 种子初始化异常:', err.message); }
    finally { _seeded = true; _seeding = null; }
  })();
}

export function requireAdmin(req) {
  const c = process.env.ADMIN_PASSWORD;
  if (!c) return { ok: false, status: 503, error: '服务器未配置管理密码' };
  if ((req.headers['x-admin-password'] || '') !== c) return { ok: false, status: 401, error: '管理密码错误' };
  return { ok: true };
}

export async function imageToUrl(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 2 * 1024 * 1024) return false;
  const ext = m[1].split('/')[1];
  const name = `reading-images/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const blob = await put(name, buffer, { access: 'public', contentType: m[1] });
  return blob.url;
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(new Error('无效 JSON')); } });
    req.on('error', reject);
  });
}
