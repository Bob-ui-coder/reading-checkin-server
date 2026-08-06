import { json, lazySeed, loadData, saveData, cleanText, parseBody, imageToUrl } from '../_lib.mjs';

export default async function handler(req, res) {
  lazySeed();
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (method !== 'POST') return json(res, { error: '方法不允许' }, 405);

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
