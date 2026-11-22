#!/usr/bin/env node
/**
 * 本地静态服务器：只服务 web/ 目录，零依赖。
 * 用法：npm run dev:classic（或 node scripts/serve.mjs --port 8080）
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  const prefixed = process.argv.find(a => a.startsWith(name + '='));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
}

const port = Number(argValue('--port', argValue('-p', process.env.PORT || 5173)));
const host = argValue('--host', process.env.HOST || '127.0.0.1');

function send(res, status, body, headers) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }

  const target = resolve(join(ROOT, pathname));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    return send(res, 403, 'Forbidden');
  }

  try {
    let file = target;
    let info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file);
    }
    if (!info.isFile()) throw new Error('not a file');

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      // 404 也按扩展名给类型：缺失的 js/css 若回 text/plain，浏览器会额外报一条 MIME 拒绝
      const type = MIME[extname(pathname).toLowerCase()];
      return send(res, 404, '', type ? { 'Content-Type': type } : undefined);
    }
    send(res, 500, 'Internal Server Error');
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。换一个端口：npm run dev:classic -- --port 5174`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`AI 沉浸式记忆练习助手：http://${host}:${port}/`);
});
