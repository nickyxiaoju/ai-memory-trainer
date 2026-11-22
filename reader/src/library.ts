import type { Progress, ReadingDoc } from './types';
import { frontier } from './progress.ts';
import { icon, ProgressIndicator, two } from './ui.ts';

type Filter = 'recent' | 'all' | 'done';
type Entry = { doc: ReadingDoc; p: Progress };

const filters = { recent: '最近阅读', all: '全部资料', done: '已读完' } as const;
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function checkpoints(doc: ReadingDoc) {
  return doc.sections.flatMap((section, page) => section.checkpoint ? [page] : []);
}

function unit(doc: ReadingDoc) { return doc.format === 'PDF' ? '页' : '节'; }
function wasOpened({ p }: Entry) { return p.updated > 0 || p.finished || p.page > 0 || p.passed.length > 0 || p.mistakes.length > 0; }

function lastRead(updated: number) {
  const date = new Date(updated);
  if (!(updated > 0) || !Number.isFinite(date.getTime())) return '暂无阅读时间';
  return `最近阅读 <time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(dateFormat.format(date))}</time>`;
}

function shelfRow(entry: Entry) {
  const { doc, p } = entry;
  const gates = checkpoints(doc);
  const passed = new Set(p.passed);
  const done = gates.filter(page => passed.has(page)).length;
  const count = doc.sections.length;
  const page = Math.max(0, Math.min(Number.isInteger(p.page) ? p.page : 0, frontier(doc, p)));
  const state = p.finished ? '已读完' : wasOpened(entry) ? '在读' : '未开始';
  const position = !count ? '暂无正文' : wasOpened(entry) ? `第 ${page + 1} / ${count} ${unit(doc)}` : `共 ${count} ${unit(doc)}`;
  return `<li class="lib-row">
    <div class="lib-cover" data-format="${escapeHtml(doc.format)}" aria-hidden="true"><span class="lib-cover-imprint">FOLIO</span><span class="lib-cover-title">${escapeHtml(doc.title)}</span><span class="lib-cover-format">${escapeHtml(doc.format)}</span></div>
    <div class="lib-entry"><p class="lib-byline"><b>${escapeHtml(doc.format)}</b>${doc.chapter ? ` <span aria-hidden="true">/</span> ${escapeHtml(doc.chapter)}` : ''}</p>
      <h3><button type="button" class="lib-open" data-act="open" data-id="${escapeHtml(doc.id)}" aria-label="${escapeHtml(`打开《${doc.title}》`)}">${escapeHtml(doc.title)}</button></h3>
      <p class="lib-last">${icon('time', 13)}<span>${lastRead(p.updated)}</span></p></div>
    <div class="lib-position"><p><strong class="lib-state" data-finished="${escapeHtml(p.finished)}">${escapeHtml(state)}</strong><span>${escapeHtml(position)}</span></p>
      ${gates.length ? `${ProgressIndicator(done, gates.length)}<small>检查点 ${escapeHtml(done)} / ${escapeHtml(gates.length)}</small>` : '<small>本文未设检查点</small>'}</div>
    <span class="lib-open-mark" aria-hidden="true">${icon('arrow', 17)}</span>
  </li>`;
}

function emptyShelf(filter: Filter, query: string, docCount: number) {
  let title = '书架还是空的', detail = '导入一份本地资料，开始第一次阅读。';
  if (docCount && query) {
    title = `没有找到“${query}”`;
    detail = `「${filters[filter]}」中没有匹配的资料。可以缩短关键词，或清空搜索。`;
  } else if (docCount && filter === 'done') {
    title = '还没有读完的资料'; detail = '在末页完成阅读后，资料会列在这里。';
  } else if (docCount && filter === 'recent') {
    title = '还没有最近阅读记录'; detail = '从「全部资料」打开一本，下一次就能从书签处接着读。';
  }
  return `<div class="lib-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div>`;
}

function importDesk(staticDemo = false) {
  if (staticDemo) {
    return `<aside class="lib-import" aria-labelledby="lib-static-title">
      <div class="lib-section-heading"><span aria-hidden="true">02</span><h2 id="lib-static-title">在线示例</h2></div>
      <div class="lib-drop"><span class="lib-drop-symbol">${icon('shield', 24)}</span><strong>在线站点只加载内置讲义</strong><small>不接收文件，也不执行本机解析。</small></div>
      <dl class="lib-formats">
        <div><dt>完整本机版</dt><dd>在仓库根运行 <code>npm run dev</code>，可导入 PDF、DOCX、PPTX 与 UTF-8 TXT；导入只发给本机解析进程，不上传云端。</dd></div>
        <div><dt>PDF 原页</dt><dd>导入的 PDF 由本机 Poppler 渲染；在线示例使用预渲染的原页图。</dd></div>
      </dl>
      <p class="lib-local">${icon('local', 16)}<span>示例旁注与检查点使用本地规则，不调用云端 AI；不支持 OCR，扫描件请先添加文字层。</span></p>
      <p class="lib-local">${icon('file', 16)}<span><a href="/Noto-OFL.txt">Noto 字体许可</a></span></p>
    </aside>`;
  }
  return `<aside class="lib-import" aria-labelledby="lib-import-title">
    <div class="lib-section-heading"><span aria-hidden="true">02</span><h2 id="lib-import-title">导入资料</h2></div>
    <div id="drop-zone" class="lib-drop"><span class="lib-drop-symbol">${icon('upload', 24)}</span><strong>将文档拖到这里</strong><small>单个文件不超过 12 MiB</small>
      <button type="button" class="primary lib-pick" data-act="pick">选择文件 ${icon('plus', 15)}</button>
      <input type="file" id="import-file" accept=".pdf,.docx,.pptx,.txt" hidden></div>
    <p id="import-state" class="lib-import-state" role="status" aria-live="polite" aria-atomic="true"></p>
    <dl class="lib-formats"><div><dt>PDF</dt><dd>本机 Poppler 渲染原页，也可提取文字层重排阅读。</dd></div>
      <div><dt>TXT / DOCX / PPTX</dt><dd>仅提取文字并重排，不保留原版式。TXT 请使用 UTF-8 编码。</dd></div></dl>
    <p class="lib-local">${icon('local', 16)}<span>本机规则生成检查点，不调用云端 AI。不支持 OCR，扫描件请先添加文字层。</span></p>
  </aside>`;
}

export function DocumentLibrary(docs: ReadingDoc[], getProgress: (doc: ReadingDoc) => Progress, filter: Filter, query: string, staticDemo = false): string {
  const entries = docs.map(doc => ({ doc, p: getProgress(doc) }));
  const finished = entries.filter(({ p }) => p.finished);
  const group = filter === 'recent' ? entries.filter(wasOpened).sort((a, b) => b.p.updated - a.p.updated)
    : (filter === 'done' ? finished : [...entries]).sort((a, b) => a.doc.title.localeCompare(b.doc.title, 'zh-CN', { numeric: true }));
  // Search catalog metadata, never gated section titles, answers or text.
  const needle = query.trim().toLocaleLowerCase();
  const visible = group.filter(({ doc }) => [doc.title, doc.chapter, doc.format].some(text => text.toLocaleLowerCase().includes(needle)));
  return `<main id="main" class="lib-page" tabindex="-1" aria-labelledby="lib-title"><header class="lib-mast">
    <div><p class="lib-kicker" lang="en">Folio / Library</p><h1 id="lib-title">我的资料库</h1><p class="lib-deck">阅读位置和检查点记录，随资料保存在此浏览器。</p></div>
    <dl class="lib-totals"><div><dt>馆藏资料</dt><dd>${escapeHtml(two(entries.length))}</dd></div><div><dt>已读完</dt><dd>${escapeHtml(two(finished.length))}</dd></div></dl></header>
    <div class="lib-layout"><nav class="lib-filters" aria-label="资料筛选"><span class="lib-nav-label">我的书架</span>${(Object.keys(filters) as Filter[]).map(key => `<button type="button" data-act="filter" data-filter="${key}" aria-pressed="${key === filter}">${icon(key === 'recent' ? 'time' : key === 'done' ? 'check' : 'library',15)}${filters[key]}</button>`).join('')}</nav><section class="lib-catalog" aria-labelledby="lib-catalog-title"><div class="lib-catalog-head">
      <div class="lib-section-heading"><span aria-hidden="true">01</span><h2 id="lib-catalog-title">书架目录</h2></div>
      <label class="lib-search">${icon('find', 15)}<input type="search" id="library-search" value="${escapeHtml(query)}" aria-label="搜索书名、章节或格式" placeholder="搜索书名、章节或格式" autocomplete="off"></label></div>
      ${visible.length ? `<ul class="lib-list" aria-label="${escapeHtml(filters[filter])}">${visible.map(shelfRow).join('')}</ul>` : emptyShelf(filter, query.trim(), entries.length)}
    </section>${importDesk(staticDemo)}</div></main>`;
}

function summaryNav() {
  return `<div class="summary-nav"><button type="button" class="text-button" data-act="library">${icon('back', 14)} 返回资料库</button><button type="button" class="primary" data-act="resume">回到原文 ${icon('arrow', 15)}</button></div>`;
}

export function LearningSummary(doc: ReadingDoc, p: Progress): string {
  const gates = checkpoints(doc);
  const passed = new Set(p.passed);
  const done = gates.filter(page => passed.has(page)).length;
  if (!p.finished || done !== gates.length) {
    return `<main id="main" class="summary-page" tabindex="-1">${summaryNav()}<header class="summary-mast"><p class="summary-kicker">学习总结</p><h1>尚未完成阅读</h1><p>完成本篇阅读后，即可查看概念笔记和检查点复盘。</p></header></main>`;
  }

  const mistakes = new Set(p.mistakes);
  const missed = gates.filter(page => mistakes.has(page));
  const practiceOrder = [...missed, ...gates.filter(page => !mistakes.has(page))];
  // Sections without an annotation (e.g. image-only pages) have no sourced concept.
  const concepts = doc.sections.map(({ annotation }, page) => annotation ?
    `<li><span class="summary-reference">第 ${escapeHtml(two(page + 1))} ${escapeHtml(unit(doc))}</span><div><h3>${escapeHtml(annotation.label)}</h3><blockquote>${escapeHtml(annotation.quote)}</blockquote></div></li>` : '').join('');
  const reviews = practiceOrder.map(page => {
    const s = doc.sections[page];
    const title = s.annotation?.label || s.title;
    const source = `第 ${page + 1} ${unit(doc)}`;
    const how = p.via?.[String(page)];
    const method = how === 'blank' ? '经原文填空核对' : how === 'answer' ? '理解题通过' : how === 'retype' ? '逐字复现' : s.checkpoint?.kind === 'blank' ? '原文填空' : s.checkpoint?.kind === 'retype' ? '原文复现' : '理解题';
    return `<li><button type="button" class="summary-retry" data-act="retry-at" data-page="${escapeHtml(page)}" aria-label="${escapeHtml(`重练${source}：${title}`)}">
      <span><small>${escapeHtml(source)} · ${escapeHtml(method)}${mistakes.has(page) ? ' · <b>曾有误答</b>' : ''}</small><strong>${escapeHtml(title)}</strong></span><span class="summary-retry-mark">重练 ${icon('redo', 13)}</span></button></li>`;
  }).join('');
  return `<main id="main" class="summary-page" tabindex="-1" aria-labelledby="summary-title">${summaryNav()}
    <header class="summary-mast"><p class="summary-kicker" lang="en">Folio / Reading notes</p><div class="summary-title-line"><div>
      <p class="summary-complete">${icon('check', 15)} 阅读完成 · 学习总结</p><h1 id="summary-title">${escapeHtml(doc.title)}</h1>
      <p class="summary-meta">${escapeHtml([doc.format, doc.chapter, `共 ${doc.sections.length} ${unit(doc)}`].filter(Boolean).join(' / '))}</p></div>
      <dl class="summary-total"><dt>已通过检查点</dt><dd>${escapeHtml(two(done))}${gates.length ? `<small> / ${escapeHtml(two(gates.length))}</small>` : ''}</dd></dl></div></header>
    <div class="summary-layout"><section aria-labelledby="summary-concepts"><div class="summary-section-heading"><span aria-hidden="true">01</span><h2 id="summary-concepts">概念笔记</h2></div>
      ${concepts ? `<ol class="summary-concepts">${concepts}</ol>` : '<p class="summary-note">本文没有带来源的概念摘录，可回到原文复习。</p>'}</section>
      <section class="summary-practice" aria-labelledby="summary-review"><div class="summary-section-heading"><span aria-hidden="true">02</span><h2 id="summary-review">检查点复盘</h2></div>
      <p class="summary-note">${escapeHtml(!gates.length ? '本文未设检查点，没有可重练的题目。' : missed.length ? `有 ${missed.length} 个检查点曾有误答，已排在前面。可回到对应原页重练。` : '没有记录到误答。想再巩固时，可以任选一个检查点重练。')}</p>
      ${reviews ? `<ul class="summary-reviews">${reviews}</ul>` : ''}</section></div></main>`;
}
