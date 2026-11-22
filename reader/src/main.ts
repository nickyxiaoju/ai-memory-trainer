/// <reference path="./shared.d.ts" />
import { demo } from './demo.ts';
import type { ReadingDoc, Progress, Checkpoint } from './types';
import { canRead, completeGate, frontier, searchReadable } from './progress.ts';
import { lastDoc, listImports, loadProgress, persist, saveLast, importFile } from './storage.ts';
import { Outline, StudySidebar, DocumentViewer } from './reader.ts';
import { DocumentLibrary, LearningSummary } from './library.ts';
import { bindCheckpoint, taskBlanks, type Route, type TaskView } from './checkpoint.ts';
import { brand, icon, button, notify, two } from './ui.ts';

const root = document.getElementById('root')!, compact = matchMedia('(max-width: 1039px)');
const staticDemo = Boolean((window as Window & { FOLIO_STATIC?: boolean }).FOLIO_STATIC);
const docs: ReadingDoc[] = [demo], memory = new Map<string, Progress>(), drafts = new Map<string,string>(), blankDrafts = new Map<string,string[]>();
let doc = demo, p = progress(doc), view: 'reader'|'library'|'summary' = 'reader';
let mode: 'pdf'|'text' = 'pdf', zoom = 1, left = true, right = true, review = false;
let practice = false, route: Route = 'blank', fallback = false, feedback = '';
let filter: 'recent'|'all'|'done' = 'all', query = '', importing = false, importMessage = '';
let pdfRequest: AbortController | undefined, pdfObject = '', pdfKey = '', popTrigger: HTMLElement | null = null;
let activePageKey = '', lastScroll = 0;
try { if (localStorage.getItem('folio.theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch {}
function progress(d:ReadingDoc) { if (!memory.has(d.id)) memory.set(d.id,loadProgress(d)); return memory.get(d.id)!; }
function save() { p.updated = Date.now(); memory.set(doc.id,p); try { persist(doc,p); saveLast(doc.id); } catch { notify('浏览器未允许保存进度，本次阅读仍可继续。'); } }
const draftKey = () => doc.id + ':' + p.page;
const taskView = (fallbackInputs = false): TaskView => ({
  practice, route, fallback, fallbackInputs, feedback,
  answerDraft: drafts.get(draftKey()) || '',
  blankDrafts: blankDrafts.get(draftKey()) || [],
});
const main = () => document.getElementById('main');
function modeFor(d:ReadingDoc) { return d.format === 'PDF' ? 'pdf' : 'text'; }
function resetTask() { practice = false; route = 'blank'; fallback = false; feedback = ''; }
let saveScroll: ReturnType<typeof setTimeout> | undefined;
function bindPosition() {
  const el = main()!;
  const position = p.position;
  if (position && position.page === p.page && position.mode === mode) {
    const top = position.offset; el.scrollTop = top;
    const img = el.querySelector<HTMLImageElement>('#pdf-img');
    if (img && !img.complete) img.addEventListener('load', () => { if (el.isConnected && !el.scrollTop) el.scrollTop = top; }, { once:true });
  }
  el.onscroll = () => {
    p.position = { page: p.page, mode, offset: el.scrollTop };
    clearTimeout(saveScroll); saveScroll=setTimeout(save,160);
  };
}
window.addEventListener('pagehide', () => { if (view==='reader' && main()) { p.position = {page:p.page,mode,offset:main()!.scrollTop}; save(); } });

function AppShell(body: string) {
  const reader = view === 'reader', dark = document.documentElement.dataset.theme === 'dark';
  return `<header class="topbar"><button data-act="library" class="brand-button" aria-label="页间，返回资料库">${brand()}</button><div class="crumb"><i></i><button data-act="library">我的资料库</button>${view !== 'library' ? `${icon('next',12)}<span>${escapeHtml(doc.title)}</span>` : ''}</div><div class="top-tools">${reader ? `<span class="compact-title">${escapeHtml(doc.chapter)}</span><button class="mobile-menu" data-act="outline" aria-label="打开目录">${icon('toc')}</button>${button('find','find','查找已解锁正文')}<i></i><button class="desktop-toggle" data-act="outline" aria-label="切换目录" aria-pressed="${left}">${icon('toc')}</button><button class="desktop-toggle" data-act="study" aria-label="切换学习旁注" aria-pressed="${right}">${icon('panel')}</button><button class="mobile-menu" data-act="study" aria-label="打开学习旁注">${icon('panel')}</button>` : ''}${button('theme',dark?'sun':'moon',dark?'切换浅色':'切换深色')}</div></header>${body}<dialog id="tool-dialog" aria-labelledby="dialog-title"></dialog>`;
}
function draw(preserve = false) {
  const prevKey = activePageKey, old = main(); if (old && prevKey) lastScroll = old.scrollTop;
  const key = view === 'reader' ? draftKey() : view;
  if (pdfKey && pdfKey !== key && pdfObject) { URL.revokeObjectURL(pdfObject); pdfObject = ''; pdfKey = ''; }
  pdfRequest?.abort(); pdfRequest = undefined;
  const masked = practice && route === 'blank';
  const body = view === 'reader' ? `<div class="workspace ${left?'':'without-left'} ${right?'':'without-right'}"><aside class="left-rail" aria-label="阅读导航">${Outline(doc,p)}</aside><main id="main" class="reader-scroll" tabindex="-1">${DocumentViewer(doc,p,mode,zoom,review,taskView())}</main><aside class="right-rail" aria-label="学习旁注">${StudySidebar(doc,p,mode,masked)}</aside></div>` : view === 'library' ? DocumentLibrary(docs,progress,filter,query,staticDemo) : LearningSummary(doc,p);
  root.innerHTML = AppShell(body); activePageKey = key;
  document.title = (view==='library'?'我的资料库':view==='summary'?'章节总结':doc.title) + ' · 页间 Folio';
  if (view === 'reader') {
    const task = doc.sections[p.page].checkpoint;
    if (task) bindCheckpoint(task, p.passed.includes(p.page), review, taskView(), {
      pass: markPassed, miss: (how) => missed(how), start: startPractice, routeTo: switchRoute, read: backToReading,
      fallback: switchToBlanks, feedbackText: (text) => { feedback = text; },
      saveAnswer: (value) => drafts.set(draftKey(), value),
      saveBlank: (index, value) => { const key = draftKey(), values = [...(blankDrafts.get(key) || [])]; values[index] = value; blankDrafts.set(key, values); },
      focusBlank: (index) => focusBlank(index),
      answerDraft: drafts.get(draftKey()) || '',
      blankDrafts: blankDrafts.get(draftKey()) || [],
    });
    if (compact.matches && mode === 'pdf' && doc.format === 'PDF') document.querySelectorAll<HTMLElement>('.blank-wrap').forEach(wrap => wrap.addEventListener('click', () => {
      if (zoom < 1.4) setZoom(1.6);
      requestAnimationFrame(() => { wrap.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); wrap.scrollIntoView({ block: 'center', inline: 'nearest' }); });
    }));
    if (mode==='pdf' && doc.format==='PDF') void showPdf();
    bindPosition();
  } else if (view === 'library') bindLibrary();
  if (preserve && prevKey===key && main()) main()!.scrollTop=lastScroll;
}
async function showPdf() {
  const img = document.querySelector<HTMLImageElement>('#pdf-img'), status = document.getElementById('page-status');
  if (!img || !status) return;
  const ready = () => { status.hidden=true; img.closest('.page-frame')?.classList.add('loaded'); syncBlankScale(); };
  const fail = () => { if (status.isConnected) { status.hidden=false; status.innerHTML='原页未能载入。<button class="mini-link" data-act="text">切换重排正文</button>'; } };
  img.onload=ready; img.onerror=fail;
  if (doc.id===demo.id) { if(img.complete && img.naturalWidth) ready(); return; }
  const pageKey = doc.id + ':' + p.page;
  if (pdfObject && pdfKey === pageKey) { img.src = pdfObject; return; }
  const ctl = new AbortController(); pdfRequest=ctl;
  try {
    const res=await fetch('/api/page?page='+(p.page+1), {method:'POST',body:doc.file, headers:{'Content-Type':'application/octet-stream'}, signal:ctl.signal});
    if(!res.ok) throw new Error(await res.text());
    const blob=await res.blob(); if(ctl.signal.aborted || !img.isConnected) return;
    if (pdfObject) URL.revokeObjectURL(pdfObject);
    pdfObject=URL.createObjectURL(blob); pdfKey=pageKey; img.src=pdfObject;
  } catch { if(!ctl.signal.aborted) fail(); }
}
function missed(_how?: 'answer'|'blank'|'retype') { if(!p.mistakes.includes(p.page)) { p.mistakes.push(p.page); save(); } }
function markPassed(how: 'answer'|'blank'|'retype') {
  const again=p.passed.includes(p.page); p=completeGate(doc,p,p.page,how); review=false; resetTask(); save();
  refreshAfterPass(); notify(again?'重练完成，原有阅读进度已保留。':p.page===doc.sections.length-1?'已通过本节检查点。':'已解锁下一节，你可以留在这里回看。');
}
function refreshAfterPass() {
  draw(true); const next=root.querySelector<HTMLElement>('.unlock-row button');
  next?.focus({preventScroll:true});
}
function startPractice(nextRoute: Route) {
  const task = doc.sections[p.page].checkpoint;
  if (!task) return;
  if (task.kind === 'retype') { document.getElementById('checkpoint')?.scrollIntoView({ block: 'center' }); document.querySelector<HTMLTextAreaElement>('#retype')?.focus({ preventScroll: true }); return; }
  const blanks = taskBlanks(task);
  route = task.kind === 'blank' ? 'blank' : blanks.length ? nextRoute : 'answer';
  practice = true; fallback = false; feedback = '';
  if (route === 'answer' && compact.matches && mode === 'pdf') {
    mode = 'text'; notify('已切到重排文字写理解；原文填空仍可在原页完成。');
  }
  if (route === 'blank' && doc.format === 'PDF' && mode === 'pdf' && blanks.some(b => !b.rects?.length)) {
    mode = 'text'; notify('本页没有可核对的原页坐标，已切到重排原文填空。');
  }
  if (route === 'blank' && compact.matches && mode === 'pdf') zoom = 1.6;
  draw(true);
  requestAnimationFrame(() => {
    if (route === 'answer') focusComposer(); else focusBlank(0);
  });
}
function switchRoute(nextRoute: Route) {
  const task = doc.sections[p.page].checkpoint;
  if (!task || task.kind === 'retype') return;
  if (nextRoute === 'blank' && !taskBlanks(task).length) return;
  route = task.kind === 'blank' ? 'blank' : nextRoute;
  practice = true; fallback = route === 'blank' ? fallback : false; feedback = '';
  if (route === 'answer' && compact.matches && mode === 'pdf') { mode = 'text'; notify('已切到重排文字写理解；原文填空仍可在原页完成。'); }
  if (route === 'blank' && doc.format === 'PDF' && mode === 'pdf' && taskBlanks(task).some(b => !b.rects?.length)) mode = 'text';
  draw(true);
  requestAnimationFrame(() => route === 'answer' ? focusComposer() : focusBlank(0));
}
function switchToBlanks(message: string) {
  fallback = true; feedback = message; route = 'blank'; practice = true;
  const task = doc.sections[p.page].checkpoint;
  if (task && doc.format === 'PDF' && mode === 'pdf' && taskBlanks(task).some(b => !b.rects?.length)) mode = 'text';
  draw(true);
  notify('没有确认到完整关系，已改用同一句原文填空；刚才的回答还留着。');
  requestAnimationFrame(() => focusBlank(0));
}
function backToReading() { practice = false; fallback = false; feedback = ''; draw(true); document.getElementById('checkpoint')?.scrollIntoView({ block: 'center' }); }
function focusBlank(index = 0) {
  const fields = [...document.querySelectorAll<HTMLInputElement>('.blank-field')];
  const field = fields[index] || fields[0];
  field?.scrollIntoView({ block: 'center', inline: 'nearest' });
  field?.focus({ preventScroll: true });
}
function focusComposer() {
  const field = document.querySelector<HTMLTextAreaElement>('#answer');
  field?.scrollIntoView({ block: 'center', inline: 'nearest' });
  field?.focus({ preventScroll: true });
}
function focusTask() {
  const el=document.getElementById('checkpoint');
  const task=doc.sections[p.page].checkpoint;
  if (!task) { el?.scrollIntoView({block:'center'}); el?.focus({preventScroll:true}); return; }
  if (task.kind === 'retype') { el?.scrollIntoView({ block: 'center' }); document.querySelector<HTMLTextAreaElement>('#retype')?.focus({ preventScroll: true }); return; }
  if (!practice) { startPractice(taskBlanks(task).length ? 'blank' : 'answer'); return; }
  if (route === 'blank') focusBlank(0); else focusComposer();
}
function navigate(i:number) {
  if(!canRead(doc,p,i)) { notify('本节尚未解锁，请先完成当前阅读边界的检查点。'); return; }
  closeDialog(false); review=false; resetTask(); if(i!==p.page) delete p.position; p.page=i; view='reader'; zoom=1; save(); draw(); main()?.focus({preventScroll:true});
}
function next() {
  const task = doc.sections[p.page].checkpoint;
  if(task && !p.passed.includes(p.page)) { if(task.kind === 'retype') { notify('先完成本节检查点，再继续阅读。'); focusTask(); } else startPractice('blank'); return; }
  if(p.page+1<doc.sections.length) return navigate(p.page+1);
  if(doc.sections.some((s,i)=>s.checkpoint && !p.passed.includes(i))) return;
  p.finished=true; save(); view='summary'; draw(); main()?.focus({preventScroll:true});
}
function openDoc(id:string) {
  const d=docs.find(row=>row.id===id); if(!d) return; doc=d; p=progress(d); mode=modeFor(d); zoom=1; review=false; resetTask(); view='reader'; save(); draw(); main()?.focus({preventScroll:true});
}
function closeDialog(focus=true) { const d=document.querySelector<HTMLDialogElement>('#tool-dialog'); if(d?.open) { d.close(); if(focus && popTrigger?.isConnected) popTrigger.focus({preventScroll:true}); } }
function openDialog(kind:'find'|'outline'|'study') {
  const d=document.querySelector<HTMLDialogElement>('#tool-dialog')!;
  if(!d.open) popTrigger=document.activeElement as HTMLElement;
  const name=kind==='find'?'查找已解锁正文':kind==='outline'?'文档目录':'学习旁注';
  d.className='dialog '+kind; d.innerHTML=`<header><h2 id="dialog-title">${name}</h2>${button('close','close','关闭面板')}</header>`+(kind==='outline'?Outline(doc,p):kind==='study'?StudySidebar(doc,p,mode,practice&&route==='blank'):`<div class="find-body"><label class="find-input">${icon('find')}<input id="doc-search" type="search" aria-label="搜索已解锁原文" placeholder="输入关键词…" autocomplete="off"></label><p class="muted">仅检索已解锁的 ${frontier(doc,p)+1} 节，不显示锁定原文。</p><div id="matches" aria-live="polite"></div></div>`);
  if(!d.open) d.showModal();
  d.onkeydown=e=>{if(e.key==='Escape' && !e.isComposing && e.keyCode!==229){e.preventDefault();closeDialog();}};
  d.onclose=()=>{ if(!document.querySelector('dialog[open]')&&document.activeElement===document.body&&popTrigger?.isConnected) popTrigger.focus(); };
  d.onclick=e=>{if(e.target===d){const box=d.getBoundingClientRect(); if(e.clientX<box.left || e.clientX>box.right || e.clientY<box.top || e.clientY>box.bottom) closeDialog();}};
  if(kind==='find') {
    const input=d.querySelector<HTMLInputElement>('input')!, result=d.querySelector<HTMLElement>('#matches')!;
    input.oninput=()=>{const hits=searchReadable(doc,p,input.value).map(h=>({...h,text:maskAnswerText(h.text)})); result.innerHTML=hits.length?hits.map(h=>`<button class="hit" data-act="page" data-page="${h.page}"><small>§ ${two(h.page+1)}</small><span>${escapeHtml(h.text)}</span>${icon('next',14)}</button>`).join(''):input.value.trim()?'<p class="empty-text">已解锁正文中没有匹配项。</p>':'';}; input.focus();
  }
}
function maskAnswerText(text: string) {
  const task = doc.sections[p.page].checkpoint;
  if (!task || !practice || route !== 'blank') return text;
  return taskBlanks(task).reduce((value, blank) => value.split(blank.answer).join('〔　〕'), text);
}
function source() {
  closeDialog(false);
  const el=root.querySelector<HTMLElement>('.flow-mark, .source-mark');
  if(!el) {
    const section=doc.sections[p.page];
    if(mode==='pdf' && doc.format==='PDF'){mode='text';draw(true);source();return;}
    const at=section.annotation ? section.paragraphs.findIndex(p=>p.includes(section.annotation!.quote)) : -1;
    const paragraph=root.querySelectorAll<HTMLElement>('.flow-page p')[Math.max(0,at)];
    if(paragraph){paragraph.tabIndex=-1;paragraph.scrollIntoView({block:'center'});paragraph.focus({preventScroll:true});}
    return;
  }
  el.scrollIntoView({block:'center',inline:'nearest'}); el.focus({preventScroll:true});
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}
function annotate() {
  if(compact.matches) return openDialog('study');
  if(!right){right=true;draw(true);} const ref=root.querySelector<HTMLElement>('.right-rail .source-ref'); ref?.focus({preventScroll:true});
  root.querySelector('.right-rail .margin-section')?.animate([{opacity:.5},{opacity:1}],{duration:matchMedia('(prefers-reduced-motion:reduce)').matches?0:180});
}
async function receive(file?:File) {
  if(!file || importing)return; importing=true;
  const stage=(s:string)=>{importMessage=s; const el=document.getElementById('import-state'); if(el){el.hidden=false; el.textContent=s;}};
  try{const d=await importFile(file,stage); docs.push(d); importMessage=''; if(view==='library')openDoc(d.id); notify('资料已保存到此浏览器。');}
  catch(e){stage(e instanceof Error ? e.message : '导入失败，请检查格式后重试。');} finally{importing=false;}
}
function bindLibrary() {
  const input=root.querySelector<HTMLInputElement>('#import-file'), drop=root.querySelector<HTMLElement>('#drop-zone'), search=root.querySelector<HTMLInputElement>('#library-search')!;
  if (input) input.onchange=()=>{void receive(input.files?.[0]); input.value='';};
  if (drop) {
    drop.ondragover=e=>{e.preventDefault(); drop.classList.add('dragging');}; drop.ondragleave=()=>drop.classList.remove('dragging');
    drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');void receive(e.dataTransfer?.files[0]);};
  }
  onCommittedInput(search, value=>{query=value;draw();root.querySelector<HTMLInputElement>('#library-search')!.focus();});
  const el=root.querySelector<HTMLElement>('#import-state'); if(el&&importMessage){el.hidden=false;el.textContent=importMessage;}
}
root.addEventListener('click', e=>{
  const b=(e.target as Element).closest<HTMLElement>('[data-act]'); if(!b)return; const act=b.dataset.act;
  if(act==='close')return closeDialog();
  if(act==='theme'){const dark=document.documentElement.dataset.theme!=='dark'; document.documentElement.dataset.theme=dark?'dark':'light';try{localStorage.setItem('folio.theme',dark?'dark':'light');}catch{}draw(true);return;}
  if(act==='library'){closeDialog(false);view='library';review=false;draw();main()?.focus({preventScroll:true});return;}
  if(act==='open')return openDoc(b.dataset.id!);
  if(act==='filter'){filter=b.dataset.filter as typeof filter;draw();root.querySelector<HTMLElement>(`[data-filter="${filter}"]`)?.focus();return;}
  if(act==='pick'){if(!importing)document.getElementById('import-file')?.click();return;}
  if(act==='retry-at'){const i=Number(b.dataset.page); if(!canRead(doc,p,i)||!p.passed.includes(i))return;navigate(i);review=true;practice=true;fallback=false;feedback='';route=taskBlanks(doc.sections[i].checkpoint).length?'blank':'answer';drafts.delete(draftKey());blankDrafts.delete(draftKey());draw();focusTask();return;}
  if(act==='resume')return navigate(p.page);
  if(act==='page')return navigate(Number(b.dataset.page));
  if(act==='prev')return navigate(p.page-1);
  if(act==='next')return next();
  if(act==='outline'||act==='study'){if(compact.matches)return openDialog(act);if(act==='outline')left=!left;else right=!right;draw(true);root.querySelector<HTMLElement>(`.desktop-toggle[data-act="${act}"]`)?.focus();return;}
  if(act==='find')return openDialog('find');
  if(act==='source')return source(); if(act==='annotation')return annotate();
  if(act==='figure'){closeDialog(false);mode='pdf';zoom=1;draw(true);const figure=root.querySelector<HTMLElement>('.pdf-scroll');figure?.scrollIntoView({block:'center'});figure?.focus({preventScroll:true});return;}
  if(act==='task'){closeDialog(false);return focusTask();}
  if(act==='pdf'||act==='text'){mode=act;zoom=1;draw(true);root.querySelector<HTMLElement>(`[data-act="${act}"]`)?.focus({preventScroll:true});return;}
  if(act==='smaller'||act==='larger')return setZoom(zoom+(act==='larger' ? .2 : -.2));
  if(act==='retry'||act==='end-review'){
    review=act==='retry'; practice=review; fallback=false; feedback='';
    if(review){const task=doc.sections[p.page].checkpoint;route=taskBiasedRoute(task);drafts.delete(draftKey());blankDrafts.delete(draftKey());}
    draw(true); if(review)focusTask(); else document.getElementById('checkpoint')?.scrollIntoView({block:'center'});
  }
});
function setZoom(value:number) {
  zoom=Math.min(1.6,Math.max(.8,Math.round(value*10)/10));
  root.querySelector<HTMLElement>('.page-frame')?.style.setProperty('--zoom',String(zoom));
  const label=root.querySelector('.zoom span'); if(label) label.textContent=Math.round(zoom*100)+'%';
  const select=root.querySelector<HTMLSelectElement>('.zoom-select'); if(select) select.value=String(zoom);
  const smaller=root.querySelector<HTMLButtonElement>('[data-act="smaller"]'); if(smaller) smaller.disabled=zoom<=.8;
  const larger=root.querySelector<HTMLButtonElement>('[data-act="larger"]'); if(larger) larger.disabled=zoom>=1.6;
  requestAnimationFrame(syncBlankScale);
}
function syncBlankScale() {
  const sheet=root.querySelector<HTMLElement>('.pdf-sheet'), img=sheet?.querySelector<HTMLImageElement>('#pdf-img');
  if(!sheet || !img || !img.naturalWidth) return;
  const height=img.getBoundingClientRect().height;
  sheet.querySelectorAll<HTMLInputElement>('.blank-wrap input').forEach(field=>{
    const wrap=field.closest<HTMLElement>('.blank-wrap');
    const ratio=parseFloat(wrap?.style.height || '4')/100;
    const length=Number(field.style.getPropertyValue('--len'))||1;
    const byHeight=ratio*height*.78;
    const byWidth=(wrap?.clientWidth||0)/(length+.35);
    field.style.fontSize=Math.max(9,Math.min(34,byHeight,byWidth))+'px';
  });
}
function taskBiasedRoute(task?: Checkpoint): Route {
  if (!task || task.kind === 'retype') return 'blank';
  return task.kind === 'blank' ? 'blank' : taskBlanks(task).length ? 'blank' : 'answer';
}
window.addEventListener('resize', () => requestAnimationFrame(syncBlankScale));
root.addEventListener('change',e=>{const select=e.target;if(select instanceof HTMLSelectElement && select.matches('.zoom-select'))setZoom(Number(select.value));});
document.addEventListener('keydown',e=>{if(view==='reader' && e.key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as Element).matches('input,textarea,[contenteditable]') && !document.querySelector('dialog[open]')){e.preventDefault();openDialog('find');}});
window.visualViewport?.addEventListener('resize',()=>{const field=document.activeElement;if(!compact.matches || !(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement))return;requestAnimationFrame(()=>{const v=window.visualViewport!,r=field.getBoundingClientRect();if(r.bottom>v.offsetTop+v.height-12 || r.top<v.offsetTop)field.scrollIntoView({block:'center'});});});
compact.addEventListener('change',()=>{closeDialog(false);if(view==='reader'){zoom=1;draw(true);}});
async function boot(){
  try{docs.push(...await listImports());}catch{notify('浏览器资料库不可用，示例仍可阅读。');}
  const restored=docs.find(d=>d.id===lastDoc()); if(restored){doc=restored;p=progress(doc);mode=doc.format==='PDF' ? (p.position?.mode ?? modeFor(doc)) : 'text';}
  save(); draw();
}
void boot();
