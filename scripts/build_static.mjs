import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outAt = process.argv.indexOf('--out');
const dist = resolve(root, outAt >= 0 ? process.argv[outAt + 1] : 'dist');
const source = join(root, 'reader', 'src');
const publicDir = join(root, 'reader', 'public');

// 构建第一步是 rm -rf 目标目录，所以只接受白名单里的产物目录：
// 一个手滑的 --out web 就会把已发布的记忆练习整个删掉。
const allowedOut = [join(root, 'dist'), join(root, 'web', 'folio')];
if (!allowedOut.includes(dist)) throw new Error(`--out 只能是 dist 或 web/folio，收到：${dist}`);
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'src'), { recursive: true });

const rewrite = code => code
  .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
  .replace(/(\bimport\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3');

// 静态版挂在站点子目录（线上是 /folio/），源码里那些「站点根绝对路径」必须改成相对路径，
// 否则浏览器会去请求站点根的 /processes-1.png 而 404。/api/ 保持绝对：那是本机开发服务的路由，
// 静态版本来不接收文件，永远不会调用它。
const ASSET_PATHS = [
  ["'/processes.pdf'", "'./processes.pdf'"],
  ['src="/processes-', 'src="./processes-'],
  ['src="/folio.svg"', 'src="./folio.svg"'],
  ['href="/Noto-OFL.txt"', 'href="./Noto-OFL.txt"'],
];
const toRelative = code => ASSET_PATHS.reduce((acc, [from, to]) => acc.split(from).join(to), code);
const LEFTOVER = /["'`]\/(?:processes|folio\.svg|Noto-OFL|src\/|shared\.js)/;

const modules = (await readdir(source)).filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts') && name !== 'types.ts');
for (const name of modules) {
  const code = stripTypeScriptTypes(await readFile(join(source, name), 'utf8'))
    .replace(/^\/\/\/\s*<reference[^\n]*\n?/gm, '');
  const js = toRelative(rewrite(code));
  if (/['"]\.{1,2}\/[^'"]+\.ts['"]/.test(js)) throw new Error(`Unresolved .ts import in ${name}`);
  if (/from ['"]\.\/types\.js['"]/.test(js)) throw new Error(`Type-only module left a runtime import in ${name}`);
  if (LEFTOVER.test(js)) throw new Error(`${name} 里还有没被改写的站点根资源路径，静态版会 404。`);
  await writeFile(join(dist, 'src', name.replace(/\.ts$/, '.js')), js);
}

for (const name of ['style.css', 'library.css']) await copyFile(join(source, name), join(dist, 'src', name));
for (const name of ['folio.svg', 'processes.pdf', 'processes-1.png', 'processes-2.png', 'processes-3.png', 'Noto-OFL.txt']) {
  await copyFile(join(publicDir, name), join(dist, name));
}
await copyFile(join(root, 'web', 'js', 'shared.js'), join(dist, 'shared.js'));

let html = await readFile(join(root, 'reader', 'index.html'), 'utf8');
const sharedTag = '<script src="/shared.js"></script>';
const skipTag = '<a class="skip-link" href="#main">跳到正文</a>';
if (!html.includes(sharedTag) || !html.includes('src="/src/main.ts"') || !html.includes(skipTag)) {
  throw new Error('Reader HTML entry changed; update the static build.');
}
// 静态版专属的返回入口：站点根是记忆练习，这里要能走回去。
// 只用行内样式加 reader 自己的 CSS 变量，深色模式跟着 data-theme 走，不新增样式文件；
// 不能用 .skip-link —— 它在 :not(:focus) 时是被 clip 隐藏的，画不出可见按钮。
const backLink = '<a href="/" class="static-back" style="position:fixed;z-index:9;right:18px;bottom:18px;display:inline-flex;'
  + 'align-items:center;padding:9px 14px;border-radius:999px;background:var(--surface);color:var(--ink);'
  + 'border:1px solid var(--strong-line);box-shadow:var(--shadow);text-decoration:none;font:13px/1.4 var(--ui)">返回记忆练习</a>';
html = html
  .replace(sharedTag, '<script>window.FOLIO_STATIC = true;</script>' + '<script src="./shared.js"></script>')
  .replace('src="/src/main.ts"', 'src="./src/main.js"')
  .replace('href="/folio.svg"', 'href="./folio.svg"')
  .replace('href="/src/style.css"', 'href="./src/style.css"')
  .replace(skipTag, skipTag + backLink);
if (/["'`]\/(?:src\/|folio\.svg|shared\.js)/.test(html)) throw new Error('静态版 index.html 还留着站点根绝对路径。');
await writeFile(join(dist, 'index.html'), html);

for (const name of ['index.html', 'src/main.js', 'src/style.css', 'src/library.css', 'shared.js', 'processes-1.png', 'processes-2.png', 'processes-3.png', 'folio.svg', 'Noto-OFL.txt']) {
  const info = await stat(join(dist, name));
  if (!info.isFile() || !info.size) throw new Error(`Missing static asset: ${name}`);
}
console.log(`页间 Folio 静态示例已生成：${dist}`);
console.log(`模块 ${modules.length} 个；仅内置讲义，导入仍走本机完整版。`);
if (dist !== join(root, 'dist')) console.log('目标在 web/ 内，会随站点一起打包；站点入口是 /folio/。');
