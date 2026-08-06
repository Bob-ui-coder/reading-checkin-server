import { createReadStream } from 'node:fs';
import { join } from 'node:path';

// Vercel 根入口 — 回退处理，实际流量由 api/* 和 public/ 处理
export default {
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const file = createReadStream(join(process.cwd(), 'public', path));
      return new Response(file, {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
};
