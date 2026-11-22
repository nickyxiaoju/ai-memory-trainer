import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const source = join(root, 'reader', 'src');
const publicDir = join(root, 'reader', 'public');

if (dist === root) throw new Error('Refusing to build over the project root.');
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'src'), { recursive: true });

const rewrite = code => code
  .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
  .replace(/(\bimport\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3');

const modules = (await readdir(source)).filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts') && name !== 'types.ts');
for (const name of modules) {
  const code = stripTypeScriptTypes(await readFile(join(source, name), 'utf8'))
    .replace(/^\/\/\/\s*<reference[^\n]*\n?/gm, '');
  const js = rewrite(code);
  if (/['"]\.{1,2}\/[^'"]+\.ts['"]/.test(js)) throw new Error(`Unresolved .ts import in ${name}`);
  if (/from ['"]\.\/types\.js['"]/.test(js)) throw new Error(`Type-only module left a runtime import in ${name}`);
  await writeFile(join(dist, 'src', name.replace(/\.ts$/, '.js')), js);
}

for (const name of ['style.css', 'library.css']) await copyFile(join(source, name), join(dist, 'src', name));
for (const name of ['folio.svg', 'processes.pdf', 'processes-1.png', 'processes-2.png', 'processes-3.png', 'Noto-OFL.txt']) {
  await copyFile(join(publicDir, name), join(dist, name));
}
await copyFile(join(root, 'web', 'js', 'shared.js'), join(dist, 'shared.js'));

let html = await readFile(join(root, 'reader', 'index.html'), 'utf8');
const sharedTag = '<script src="/shared.js"></script>';
if (!html.includes(sharedTag) || !html.includes('src="/src/main.ts"')) throw new Error('Reader HTML entry changed; update the static build.');
html = html
  .replace(sharedTag, '<script>window.FOLIO_STATIC = true;</script>' + sharedTag)
  .replace('src="/src/main.ts"', 'src="/src/main.js"');
await writeFile(join(dist, 'index.html'), html);

for (const name of ['index.html', 'src/main.js', 'src/style.css', 'src/library.css', 'shared.js', 'processes-1.png', 'processes-2.png', 'processes-3.png', 'folio.svg', 'Noto-OFL.txt']) {
  const info = await stat(join(dist, name));
  if (!info.isFile() || !info.size) throw new Error(`Missing static asset: ${name}`);
}
console.log(`页间 Folio 静态示例已生成：${dist}`);
console.log(`模块 ${modules.length} 个；仅内置讲义，导入仍走本机完整版。`);
