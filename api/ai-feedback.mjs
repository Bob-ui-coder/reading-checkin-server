function cleanText(v, m) { return typeof v === 'string' ? v.trim().slice(0, m) : ''; }
function json(res, data, s = 200) { res.status(s).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(data)); }
function parseBody(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c.toString(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(new Error('无效 JSON')); } }); req.on('error', reject); }); }

// === ai-feedback ===
export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (method !== 'POST') return json(res, { error: '方法不允许' }, 405);
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return json(res, { error: 'AI 教练尚未由管理员配置' }, 503);
  const body = await parseBody(req);
  const text = cleanText(body.text, 2000);
  if (!text) return json(res, { error: '缺少读书心得' }, 400);
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4.1-mini', temperature: 0.7, max_tokens: 220,
        messages: [{ role: 'system', content: '你是温暖、具体的读书教练。用中文给出不超过120字的反馈：先肯定一个具体洞察，再追问一个可行动的问题。不要编造书中内容。' }, { role: 'user', content: text }] })
    });
    if (!response.ok) throw new Error(`上游服务返回 ${response.status}`);
    const payload = await response.json();
    const feedback = cleanText(payload.choices?.[0]?.message?.content, 600);
    if (!feedback) throw new Error('上游服务未返回内容');
    return json(res, { feedback });
  } catch (error) { console.error('AI 请求失败:', error.message); return json(res, { error: 'AI 教练暂时不可用，请稍后重试' }, 502); }
}
