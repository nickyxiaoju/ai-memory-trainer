import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { spawn } from 'node:child_process';

const base = dirname(dirname(fileURLToPath(import.meta.url)));
const portArg = process.argv.indexOf('--port');
const port = Number(portArg < 0 ? process.env.PORT || 5173 : process.argv[portArg + 1]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.ts': 'application/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf' };
const maxBytes = 12 * 1024 * 1024;
let active = 0;

function run(args, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [join(base, 'scripts/read_document.py'), ...args], { timeout: 45000, killSignal: 'SIGKILL' });
    let size = 0, error = ''; const parts = [];
    child.stdout.on('data', b => { size += b.length; if (size <= 25 * 1024 * 1024) parts.push(b); else child.kill('SIGKILL'); });
    child.stderr.on('data', b => { if (error.length < 2000) error += b.toString(); });
    child.on('error', () => reject(new Error('未找到 Python 3，无法使用本机文档解析。')));
    child.on('close', code => code === 0 ? resolve(Buffer.concat(parts)) : reject(new Error(error.trim().slice(0, 240) || '文件过大、解析超时或渲染失败。')));
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
  });
}

const server = createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  try {
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) return send(403, '仅限本机访问');
    const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
    if (path === '/api/analyse' || path === '/api/page') {
      if (req.method !== 'POST') return send(405, '请使用阅读器导入');
      if (req.headers.origin !== url.origin || req.headers['content-type'] !== 'application/octet-stream') return send(403, '仅接受来自本机阅读器的文件');
      let args;
      if (path.endsWith('analyse')) {
        const kind = url.searchParams.get('format');
        if (!['pdf', 'txt', 'docx', 'pptx'].includes(kind)) return send(400, '不支持该文档格式');
        args = ['analyse', kind];
      } else {
        const n = Number(url.searchParams.get('page'));
        if (!Number.isInteger(n) || n < 1 || n > 500) return send(400, '页码无效');
        args = ['render', String(n), '1600'];
      }
      if (active >= 4) return send(429, '本机正在处理其他页面，请稍后重试');
      if (Number(req.headers['content-length']) > maxBytes) return send(413, '单个文件不能超过 12 MiB');
      active++;
      try {
        const parts = []; let size = 0;
        for await (const b of req) { size += b.length; if (size > maxBytes) return send(413, '单个文件不能超过 12 MiB'); parts.push(b); }
        if (!size) return send(400, '文件为空');
        const output = await run(args, Buffer.concat(parts));
        return send(200, output, path.endsWith('page') ? 'image/png' : 'application/json; charset=utf-8');
      } catch (e) { return send(422, e.message); }
      finally { active--; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method Not Allowed');
    let target;
    if (path === '/') target = 'reader/index.html';
    else if (path === '/shared.js') target = 'web/js/shared.js';
    else if (/^\/src\/[A-Za-z][\w.-]*\.(?:ts|css)$/.test(path)) target = 'reader' + path;
    else if (/^\/(?:folio\.svg|processes\.pdf|processes-[1-3]\.png)$/.test(path)) target = 'reader/public' + path;
    else return send(404, 'Not Found');
    const file = await readFile(join(base, target));
    return send(200, target.endsWith('.ts') ? stripTypeScriptTypes(file.toString()) : file, mime[extname(target)]);
  } catch (e) { send(e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'Not Found' : '读取失败'); }
});
server.requestTimeout = 55000;
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已使用，可用 npm run dev -- --port 5174` : e.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`页间 Folio · http://127.0.0.1:${port}/`));
