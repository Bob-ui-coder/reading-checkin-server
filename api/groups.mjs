import { json, lazySeed, loadData, cleanText } from '../_lib.mjs';

export default async function handler(req, res) {
  lazySeed();
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
