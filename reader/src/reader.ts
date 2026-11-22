import type { ReadingDoc, Progress, Section, Annotation, Blank } from './types';
import { frontier } from './progress.ts';
import { icon, button, two, ProgressIndicator } from './ui.ts';
import { AnswerComposer, BlankField, BlankWrap, LearningCheckpoint, taskBlanks, type TaskView } from './checkpoint.ts';
import { findCodePoints, sliceCodePoints } from './text.ts';

export function Outline(doc: ReadingDoc, p: Progress) {
  const limit = frontier(doc, p), count = doc.sections.filter(s => s.checkpoint).length;
  return `<div class="rail-top"><span class="eyebrow">WORKSPACE</span><button class="rail-back" data-act="library">${icon('library',18)} 我的资料库 ${icon('next',13)}</button></div>
    <div class="doc-ident"><div class="book-spine" aria-hidden="true"><i></i><b></b></div><div><strong>${escapeHtml(doc.title)}</strong><small>${doc.format} 文档 · ${doc.sections.length} 节</small></div></div>
    <div class="outline-body"><div class="group-title">文档目录</div><div class="chapter-nav">${icon('book',15)} ${escapeHtml(doc.chapter)}</div><nav class="outline" aria-label="文档目录">${doc.sections.map((s,i) => {
      const locked = i > limit, current = i === p.page;
      return `<button data-act="page" data-page="${i}" ${locked ? 'aria-disabled="true"' : ''} ${current ? 'aria-current="page"' : ''}><span class="ordinal">${two(i+1)}</span><span>${locked && doc.id !== 'os-processes' ? '未解锁的第 ' + (i+1) + ' 节' : escapeHtml(s.title)}</span>${locked ? icon('lock',13) : p.passed.includes(i) ? icon('check',13) : current ? '<i class="active-pin"></i>' : ''}</button>`;
    }).join('')}</nav><button class="rail-search" data-act="find">${icon('find',15)} 查找已解锁内容</button></div>
    <div class="rail-foot"><div class="row-between"><strong>本章进度</strong><span class="tabular">${p.passed.length} / ${count}</span></div>${ProgressIndicator(p.passed.length,count)}<p>${p.finished ? '已完成本章，可随时回看' : `已解锁 ${limit+1} / ${doc.sections.length} 节`}</p><div class="device">${icon('local',14)} 进度保存在此浏览器</div></div>`;
}

function maskedQuote(quote: string, blanks: Blank[]) {
  const spans = blanks.map(b => {
    const at = findCodePoints(quote, b.quote);
    if (at < 0) return null;
    return { start: at + b.offset, end: at + b.offset + Array.from(b.answer).length };
  }).filter((v): v is NonNullable<typeof v> => v !== null).sort((a, b) => a.start - b.start);
  if (!spans.length) return quote;
  let pos = 0, text = '';
  for (const span of spans) {
    if (span.start < pos) continue;
    text += sliceCodePoints(quote, pos, span.start) + '〔　〕';
    pos = span.end;
  }
  return text + sliceCodePoints(quote, pos, Infinity);
}

export function StudySidebar(doc: ReadingDoc, p: Progress, mode:'text'|'pdf', mask = false) {
  const s = doc.sections[p.page], a = s.annotation, passed = p.passed.includes(p.page), task = s.checkpoint;
  const number = two(p.page+1), demo = doc.id === 'os-processes';
  const quote = a && mask && task ? maskedQuote(a.quote, taskBlanks(task)) : a?.quote;
  return `<div class="study-head"><span class="eyebrow">MARGIN NOTES</span><div class="row-between"><h2>学习旁注</h2><span class="fine-index">/ ${number}</span></div></div>
    ${a ? `<section class="margin-section"><div class="group-title">${icon('highlight',15)} 本节知识点</div><h3 class="concept">${escapeHtml(a.label)}</h3><blockquote>${escapeHtml(quote)}</blockquote><button class="source-ref" data-act="source">${icon('location',14)} 原文 · 第 ${p.page+1} ${doc.format==='PDF' ? '页' : '节'} ${icon('next',12)}</button></section>
    <section class="margin-section"><div class="group-title">${icon('text',15)} ${demo ? '讲义释义' : '摘录说明'}</div><p>${escapeHtml(a.explanation)}</p>${demo && mode==='text' ? `<button class="source-ref figure-link" data-act="figure">${icon('file',14)} 查看原页图 ${p.page+1} ${icon('next',12)}</button>` : ''}</section>` : `<section class="margin-section"><div class="group-title">原页提示</div><p>本节没有可定位的文字摘录。请在原页查看图表或扫描图像。</p></section>`}
    <section class="margin-section"><div class="group-title">${icon('flag',15)} 当前学习任务</div><button class="task-link" data-act="task"><span class="task-index">${passed || !task ? icon('check',15) : icon(task.kind === 'answer' ? 'edit' : 'keyboard',16)}</span><span><strong>${task ? task.kind === 'answer' ? (taskBlanks(task).length ? '补全关键词或说说理解' : '用自己的话解释') : task.kind === 'blank' ? '在原文中补全关键词' : '逐字复现关键句' : '读完本节'}</strong><small>${passed ? '已通过 · 可以重练' : task ? '在原页或重排原文中完成' : '阅读后继续或查看总结'}</small></span>${icon('next',14)}</button></section>
    <div class="data-note">${icon('shield',14)}<span>${demo ? '演示旁注与检查点为预设内容，使用本地规则验证。' : '摘录与检查点由本机规则生成，未调用云端 AI。'}</span></div>`;
}

export function AnnotationLayer(a?: Annotation) {
  return (a?.rects || []).filter(r => r.every(Number.isFinite) && r[2] > 0 && r[3] > 0).map(([x,y,w,h],i) => `<button class="source-mark" ${i ? 'tabindex="-1"' : ''} aria-label="查看原文标注：${escapeHtml(a!.label)}" data-act="annotation" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"></button>`).join('');
}

function blankParagraph(text: string, blanks: Blank[], indexes: number[], paragraph: number) {
  const spans = indexes.map(i => {
    const b = blanks[i];
    if (b.paragraph !== undefined && b.paragraph !== paragraph) return null;
    const at = findCodePoints(text, b.quote);
    if (at < 0) return null;
    return { i, b, start: at + b.offset, end: at + b.offset + Array.from(b.answer).length };
  }).filter((v): v is NonNullable<typeof v> => v !== null).sort((a, b) => a.start - b.start);
  if (!spans.length) return null;
  let pos = 0, html = '';
  for (const span of spans) {
    if (span.start < pos) continue;
    html += escapeHtml(sliceCodePoints(text, pos, span.start)) + BlankField(span.b, span.i, blanks.length);
    pos = span.end;
  }
  return html + escapeHtml(sliceCodePoints(text, pos, Infinity));
}

function flowPage(doc: ReadingDoc, s: Section, i: number, mode: 'text' | 'pdf', taskView: TaskView) {
  const a = s.annotation;
  const task = s.checkpoint;
  const blanks = taskView.practice && taskView.route === 'blank' && !taskView.fallbackInputs ? taskBlanks(task) : [];
  const indexes = blanks.map((_, n) => n);
  let marked = false;
  const composer = taskView.practice && taskView.route === 'answer' && task?.kind === 'answer' ? AnswerComposer(taskView.answerDraft, i + 1, doc.format) : '';
  const composerAfter = a ? s.paragraphs.findIndex(p => p.includes(a.quote)) : 0;
  const lines = s.paragraphs.map((p, n) => {
    if (blanks.length) {
      const filled = blankParagraph(p, blanks, indexes, n);
      if (filled !== null) return `<p>${filled}</p>${n === (composerAfter < 0 ? 0 : composerAfter) ? composer : ''}`;
    }
    const at = a && !marked ? p.indexOf(a.quote) : -1;
    const line = at < 0 ? `<p>${escapeHtml(p)}</p>` : (marked = true, `<p>${escapeHtml(p.slice(0, at))}<button class="flow-mark" data-act="annotation">${escapeHtml(a!.quote)}</button>${escapeHtml(p.slice(at + a!.quote.length))}</p>`);
    return line + (n === (composerAfter < 0 ? 0 : composerAfter) ? composer : '');
  }).join('');
  return `<article class="flow-page"><div class="paper-header"><span>${escapeHtml(doc.title)}</span><span>${two(i+1)} / ${two(doc.sections.length)}</span></div><span class="paper-kicker">${doc.id === 'os-processes' ? '操作系统笔记' : '重排正文'} &nbsp; / &nbsp; § ${two(i+1)}</span><h2>${escapeHtml(s.title)}</h2>${lines}${a && !marked && !blanks.length ? `<div class="extra-source"><small>本节摘录</small><button class="flow-mark" data-act="annotation">${escapeHtml(a.quote)}</button></div>` : ''}</article>`;
}

function blankLayer(blanks: Blank[]) {
  if (!blanks.length || blanks.some(b => !b.rects?.length)) return '';
  return `<div class="blank-layer">${blanks.map((b, i) => BlankWrap(b, i, blanks.length)).join('')}</div>`;
}

function composerLayer(s: Section, page: number, format: string, draft: string) {
  const rect = s.annotation?.rects?.[0];
  const left = rect ? Math.min(0.58, Math.max(0.03, rect[0])) : 0.08;
  const top = rect ? Math.min(0.7, rect[1] + rect[3] + 0.02) : 0.3;
  return `<div class="pdf-composer" style="left:${left * 100}%;top:${top * 100}%">${AnswerComposer(draft, page, format)}</div>`;
}

export function DocumentViewer(doc:ReadingDoc, p: Progress, mode:'pdf'|'text', zoom:number, review:boolean, view: TaskView) {
  const page=p.page, s=doc.sections[page], last=page===doc.sections.length-1, gate=!!s.checkpoint&&!p.passed.includes(page);
  const pdf=doc.format==='PDF', original=pdf&&mode==='pdf';
  const task = s.checkpoint, blanks = taskBlanks(task);
  const activeBlanks = view.practice && view.route === 'blank' ? blanks : [];
  const textAnchored = blanks.every(b => s.paragraphs.some((text, n) => (b.paragraph === undefined || b.paragraph === n) && text.includes(b.quote)));
  const pdfAnchored = blanks.length > 0 && blanks.every(b => !!b.rects?.length);
  const fallbackInputs = view.practice && view.route === 'blank' && !(original ? pdfAnchored : textAnchored);
  const taskView = { ...view, fallbackInputs };
  const composer = view.practice && view.route === 'answer' && task?.kind === 'answer';
  const following = s.checkpoint && p.passed.includes(page) && !last && page+1<=frontier(doc,p) ? doc.sections[page+1] : null;
  const continuation = following && !review ? `<section class="continuation"><span class="eyebrow">下一节已开放 &nbsp; / &nbsp; ${two(page+2)}</span><h3>${escapeHtml(following.title)}</h3><p>${escapeHtml(following.paragraphs[0]?.slice(0,140) || '打开原页查看本节内容。')}</p><button class="text-button" data-act="next">阅读这一节 ${icon('arrow',14)}</button></section>` : '';
  const summary = s.checkpoint ? LearningCheckpoint(s.checkpoint,p.passed.includes(page),review,last,taskView) : `<section class="chapter-end" id="checkpoint" tabindex="-1"><span>${icon(last ? 'flag' : 'book')} ${last ? '已到本章末尾' : '已到本节末尾'}</span><button class="primary" data-act="next">${last ? '完成阅读，查看总结' : '继续阅读'} ${icon('arrow',15)}</button></section>`;
  return `<div class="reader-in"><header class="chapter-head"><div class="chapter-kicker"><i></i>${doc.id === 'os-processes' ? 'COMPUTER SCIENCE' : 'DOCUMENT READER'} <span>/</span> ${doc.id === 'os-processes' ? '计算机科学' : '我的资料'}</div><h1>${escapeHtml(doc.chapter === '文档阅读' ? doc.title : doc.chapter)}</h1><p><span>${escapeHtml(doc.chapter === '文档阅读' ? doc.format + ' 文档' : doc.title)}</span><b>·</b><span>${doc.sections.length} 节</span><b>·</b><span>${doc.sections.filter(t=>t.checkpoint).length} 个检查点</span></p></header>
    <div class="reader-tools" aria-label="阅读工具"><div class="mode-switch">${pdf ? `<button data-act="pdf" aria-pressed="${original}">${icon('file',14)} 原页</button>` : ''}<button data-act="text" aria-pressed="${!original}">${icon('text',14)} 重排</button></div><div class="zoom">${button('smaller','minus','缩小',zoom<=0.8?'disabled':'')}<span>${Math.round(zoom*100)}%</span>${button('larger','plus','放大',zoom>=1.6?'disabled':'')}</div><select class="zoom-select" aria-label="阅读缩放">${[.8,1,1.2,1.4,1.6].map(n=>`<option value="${n}" ${n===zoom?'selected':''}>${Math.round(n*100)}%</option>`).join('')}</select><div class="page-nav">${button('prev','back','上一节',page===0?'disabled':'')}<span>${two(page+1)} <b>/</b> ${two(doc.sections.length)}</span>${button('next','next',last?'查看章节总结':'下一节',gate?'aria-disabled="true"':'')}</div></div>
    <div class="page-frame ${original ? 'original' : 'reflow'}" style="--zoom:${zoom}">${original ? `<div class="pdf-scroll" tabindex="0" aria-label="原页，放大后可在页内横向滚动"><div class="pdf-sheet"><img id="pdf-img" ${doc.id === 'os-processes' ? `src="/processes-${page+1}.png"` : ''} alt="${escapeHtml(doc.title)}第 ${page+1} 页；可切换重排正文逐段阅读"><div class="annotation-layer">${AnnotationLayer(s.annotation)}</div>${view.practice && view.route === 'blank' && pdfAnchored ? blankLayer(activeBlanks) : ''}${composer ? composerLayer(s, page + 1, doc.format, view.answerDraft) : ''}</div></div><div id="page-status" role="status">正在载入原页…</div>` : flowPage(doc,s,page,mode,taskView)}</div>
    <div class="page-caption"><span><i></i>${original ? '原页视图' : '可重排文本'}${s.annotation ? ' · 点击琥珀色标注查看旁注' : ''}</span><span class="tabular">${two(page+1)} / ${two(doc.sections.length)}</span></div>${summary}${continuation}</div>`;
}
