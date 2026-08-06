const GIST_ID = process.env.GIST_ID || '9118572982a150ace89f2ba81ecb7999';
const GIST_RAW = `https://gist.githubusercontent.com/Bob-ui-coder/${GIST_ID}/raw/data.json`;

export default {
  async fetch(req) {
    return new Response(JSON.stringify({
      ok: true,
      aiEnabled: Boolean(process.env.AI_API_KEY),
      storage: 'gist'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
