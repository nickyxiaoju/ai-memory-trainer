import type { Blank, Checkpoint } from './types';
import { icon } from './ui.ts';
import { checkAnswer, retypeChars, blanksDone } from './validation.ts';
import { sliceCodePoints } from './text.ts';

export type Route = 'blank' | 'answer';

export interface TaskView {
  practice: boolean;
  route: Route;
  fallback: boolean;
  fallbackInputs: boolean;
  feedback: string;
  answerDraft: string;
  blankDrafts: string[];
}

export interface CheckpointContext {
  pass(how: 'answer' | 'blank' | 'retype'): void;
  miss(how: 'answer' | 'blank' | 'retype'): void;
  start(route: Route): void;
  routeTo(route: Route): void;
  read(): void;
  fallback(message: string): void;
  feedbackText(message: string): void;
  saveAnswer(value: string): void;
  saveBlank(index: number, value: string): void;
  focusBlank(index: number): void;
  answerDraft: string;
  blankDrafts: string[];
}

export function taskBlanks(task?: Checkpoint): Blank[] {
  return task && 'blanks' in task && task.blanks ? task.blanks : [];
}

export function BlankField(blank: Blank, index: number, total: number, kind = 'flow') {
  const size = Array.from(blank.answer).length;
  return `<input class="blank-field ${kind === 'flow' ? 'flow-blank-field' : ''}" id="blank-${index}" data-blank="${index}" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" aria-label="第 ${index + 1} 空，共 ${total} 空，填 ${size} 个字" style="--len:${size}">`;
}

export function BlankWrap(blank: Blank, index: number, total: number) {
  const r = blank.rects?.[0];
  if (!r) return '';
  return `<span class="blank-wrap" style="left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%">${BlankField(blank, index, total, 'pdf')}</span>`;
}

export function AnswerComposer(draft: string, page: number, format: string) {
  return `<aside class="inline-composer" aria-label="先说说你的理解">
    <div class="composer-head"><span class="composer-kicker">${icon('edit', 14)} 先说说理解</span><button class="source-ref" data-act="source">${icon('location', 13)} 原文 · 第 ${page} ${format === 'PDF' ? '页' : '节'}</button></div>
    <textarea class="editor" id="answer" rows="3" autocomplete="off" placeholder="用自己的话写下理解…">${escapeHtml(draft)}</textarea>
    <div class="composer-actions"><button id="submit-answer" class="primary" disabled>验证回答 ${icon('enter', 15)}</button><button class="text-button" data-act="use-blanks">改用原文填空</button><span class="key-hint">Enter 提交 · Shift+Enter 换行</span></div>
    <p class="feedback composer-feedback" role="status" aria-live="polite"></p>
  </aside>`;
}

export function RetypingExercise(target: string) {
  return `<div class="target" aria-label="待复现原文：${escapeHtml(target)}"></div><label class="sr-only" for="retype">逐字复现输入</label><textarea id="retype" class="editor" rows="2" autocomplete="off" spellcheck="false" placeholder="在这里逐字输入原文…"></textarea><div class="retype-status"><span id="char-count"></span><span>标点、空格、大小写须一致；全角英数、ASCII 符号和空格可用半角。</span></div>`;
}

export function UnlockTransition(last: boolean) {
  return `<div class="unlock-row"><span>${icon('check')} ${last ? '已通过本节检查点' : '已通过，下一节已解锁'}</span><button class="text-button" data-act="next">${last ? '查看总结' : '继续阅读'} ${icon('arrow', 15)}</button></div>`;
}

function hintBlock(task: Checkpoint) {
  return `<button id="hint" class="text-button" aria-expanded="false">${icon('bulb', 15)} 提示</button><p class="hint-text" id="hint-text" hidden>${escapeHtml(task.hint)} <button class="mini-link" data-act="source">回到原文 ${icon('next', 12)}</button></p>`;
}

function quoteWithField(blank: Blank, index: number, total: number) {
  const len = Array.from(blank.answer).length;
  return `<blockquote class="blank-quote">${escapeHtml(sliceCodePoints(blank.quote, 0, blank.offset))}${BlankField(blank, index, total)}${escapeHtml(sliceCodePoints(blank.quote, blank.offset + len, Infinity))}</blockquote>`;
}

function blankBody(task: Checkpoint, view: TaskView) {
  const blanks = taskBlanks(task);
  const matched = blanksDone(view.blankDrafts, blanks).filter(Boolean).length;
  const hasAnswer = task.kind === 'answer';
  const where = view.fallbackInputs ? '在下方原文摘录中补全被遮住的词。' : '在原文中补全被遮住的词；标点不用重输。';
  return `<p class="blank-note">${icon('edit', 14)} ${where}<span class="blank-progress" id="blank-progress">${matched} / ${blanks.length} 处一致</span></p>
    ${view.fallbackInputs ? `<div class="blank-fallback">${blanks.map((b, i) => quoteWithField(b, i, blanks.length)).join('')}</div>` : ''}
    ${view.fallback ? `<p class="fallback-note">${icon('arrow', 14)} 没有确认到完整关系，已改用原文填空。刚才的回答还留着。<button class="mini-link" data-act="back-to-answer">回到刚才的说法</button></p>` : ''}
    <div class="cp-actions">${hintBlock(task)}${hasAnswer ? `<button class="text-button" data-act="explain">${icon('edit', 14)} 先说说理解</button>` : ''}<button class="text-button" data-act="read">${icon('book', 14)} 回到阅读</button></div>`;
}

function answerBody(task: Checkpoint, view: TaskView) {
  return `<p class="blank-note">${icon('edit', 14)} 在上方原文旁写下你的理解；没有确认到关系时，会改用同一句原文填空。</p>
    ${view.fallback ? `<p class="fallback-note">${icon('arrow', 14)} 已切换到原文填空。刚才的回答还留着。<button class="mini-link" data-act="back-to-answer">回到刚才的说法</button></p>` : ''}
    <div class="cp-actions">${hintBlock(task)}<button class="text-button" data-act="use-blanks">${icon('keyboard', 14)} 改用原文填空</button><button class="text-button" data-act="read">${icon('book', 14)} 回到阅读</button></div>`;
}

export function LearningCheckpoint(task: Checkpoint, passed: boolean, review: boolean, last: boolean, view: TaskView) {
  if (task.kind === 'retype') {
    return `<section id="checkpoint" class="checkpoint" aria-label="阅读检查点" tabindex="-1"><div class="cp-meta"><span class="cp-symbol">${icon('keyboard', 15)}</span><b>阅读检查点</b><i></i>原文复现${passed && !review ? `<button class="mini-link push" data-act="retry">${icon('redo', 13)} 重练</button>` : ''}</div><h3>${escapeHtml(task.prompt)}</h3>
      ${passed && !review ? UnlockTransition(last) : RetypingExercise(task.target) + `<p class="feedback" id="feedback" role="status" aria-live="polite"></p>${passed ? '<button class="mini-link" data-act="end-review">结束重练，保留原进度</button>' : `<div class="locked-line">${icon('lock', 14)} ${last ? '通过后即可完成本章' : '通过这个检查点，继续下一节'}</div>`}`}</section>`;
  }
  const blanks = taskBlanks(task);
  const label = task.kind === 'answer' ? (blanks.length ? '理解题 · 可填空' : '理解题') : '原文填空';
  const meta = `<div class="cp-meta"><span class="cp-symbol">${icon(task.kind === 'answer' ? 'edit' : 'keyboard', 15)}</span><b>阅读检查点</b><i></i>${label}${passed && !review ? `<button class="mini-link push" data-act="retry">${icon('redo', 13)} 重练</button>` : ''}</div>`;
  if (passed && !review) return `<section id="checkpoint" class="checkpoint" aria-label="阅读检查点" tabindex="-1">${meta}<h3>${escapeHtml(task.prompt)}</h3>${UnlockTransition(last)}</section>`;

  const start = blanks.length
    ? `<button class="primary" data-act="practice">${icon('edit', 14)} 开始原位填空</button>${task.kind === 'answer' ? `<button class="text-button" data-act="explain">${icon('edit', 14)} 先说说理解</button>` : ''}`
    : `<button class="primary" data-act="explain">${icon('edit', 14)} 开始作答</button>`;
  const body = !view.practice ? `<div class="cp-actions">${start}</div>${hintBlock(task)}` : view.route === 'answer' ? answerBody(task, view) : blankBody(task, view);
  return `<section id="checkpoint" class="checkpoint ${view.practice ? 'is-practicing' : ''}" aria-label="阅读检查点" tabindex="-1">${meta}<h3>${escapeHtml(task.prompt)}</h3>${body}<p class="feedback" id="feedback" role="status" aria-live="polite">${escapeHtml(view.feedback)}</p>${passed ? '<button class="mini-link" data-act="end-review">结束重练，保留原进度</button>' : `<div class="locked-line">${icon('lock', 14)} ${last ? '通过后即可完成本章' : '通过这个检查点，继续下一节'}</div>`}</section>`;
}

function blockInsertion(e: Event, message: string) {
  e.preventDefault();
  const fb = document.querySelector<HTMLElement>('#feedback');
  if (fb) fb.textContent = message;
}

function bindBlanks(task: Checkpoint, ctx: CheckpointContext) {
  const blanks = taskBlanks(task);
  const fields = [...document.querySelectorAll<HTMLInputElement>('.blank-field')];
  if (!fields.length) return;
  const progress = document.getElementById('blank-progress');
  const feedback = document.getElementById('feedback');
  const update = () => {
    const matched = blanksDone(fields.map(f => f.value), blanks).filter(Boolean).length;
    if (progress) progress.textContent = `${matched} / ${blanks.length} 处一致`;
    return matched === blanks.length;
  };
  fields.forEach((field, index) => {
    const blank = blanks[index];
    if (!blank) return;
    field.addEventListener('paste', e => blockInsertion(e, '原位填空不接受粘贴，请手动输入。'));
    field.addEventListener('drop', e => blockInsertion(e, '原位填空不接受拖入文字，请手动输入。'));
    field.addEventListener('beforeinput', e => {
      if (e.inputType.startsWith('insertFromPaste') || e.inputType === 'insertFromDrop') blockInsertion(e, '原位填空不接受粘贴或拖入文字，请手动输入。');
    });
    const paint = (commit: boolean) => {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('data-state');
      if (!field.value.trim()) return;
      if (blanksDone(fields.map(f => f.value), blanks)[index]) field.dataset.state = 'ok';
      else {
        field.dataset.state = 'bad';
        field.setAttribute('aria-invalid', 'true');
        if (commit) { ctx.miss('blank'); ctx.feedbackText(`第 ${index + 1} 空与原文不同，可对照上下文修改。`); if (feedback) feedback.textContent = `第 ${index + 1} 空与原文不同，可对照上下文修改。`; }
      }
    };
    field.addEventListener('input', () => { field.removeAttribute('data-state'); field.removeAttribute('aria-invalid'); update(); });
    onCommittedInput(field, value => {
      ctx.saveBlank(index, value);
      if (update()) ctx.pass('blank');
      else if (value.trim() && blanksDone(fields.map(f => f.value), blanks)[index]) paint(false);
    });
    field.addEventListener('blur', () => paint(true));
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); paint(true);
        const next = fields[index + 1]; next ? next.focus({ preventScroll: true }) : update();
      }
    });
    field.value = ctx.blankDrafts[index] || '';
  });
  update();
}

function bindComposer(task: Checkpoint, ctx: CheckpointContext) {
  const field = document.querySelector<HTMLTextAreaElement>('#answer');
  const submit = document.querySelector<HTMLButtonElement>('#submit-answer');
  if (!field || !submit) return;
  const feedback = document.getElementById('feedback');
  const local = document.querySelector<HTMLElement>('.composer-feedback');
  const show = (message: string) => { if (feedback) feedback.textContent = message; if (local) local.textContent = message; ctx.feedbackText(message); };
  field.value = ctx.answerDraft;
  submit.disabled = !field.value.trim();
  let composing = false;
  field.addEventListener('compositionstart', () => { composing = true; });
  field.addEventListener('compositionend', () => { composing = false; });
  field.addEventListener('input', () => { ctx.saveAnswer(field.value); submit.disabled = !field.value.trim() || field.readOnly; });
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing && e.keyCode !== 229) { e.preventDefault(); submit.click(); }
  });
  submit.addEventListener('click', () => {
    if (composing || field.readOnly || !field.value.trim()) return;
    const result = checkAnswer(field.value);
    if (result.ok) { ctx.pass('answer'); return; }
    if (result.contradicted) ctx.miss('answer');
    if (!result.contradicted && taskBlanks(task).length) { ctx.fallback(result.message); return; }
    show(result.message);
    field.readOnly = false; submit.disabled = false; submit.innerHTML = `重新验证 ${icon('enter', 15)}`; field.focus({ preventScroll: true });
  });
  field.focus({ preventScroll: true });
}

function bindRetype(task: Extract<Checkpoint, { kind: 'retype' }>, ctx: CheckpointContext) {
  const field = document.querySelector<HTMLTextAreaElement>('#retype')!;
  const feedback = document.querySelector<HTMLElement>('#feedback');
  if (!field || !feedback || field.readOnly) return;
  field.value = ctx.answerDraft;
  const expected = retypeChars(task.target), target = document.querySelector('.target')!, count = document.getElementById('char-count')!;
  const letters = Array.from(task.target.normalize('NFC'), c => { const el = document.createElement('span'); el.textContent = c; el.setAttribute('aria-hidden', 'true'); return el; });
  target.replaceChildren(...letters);
  let wasWrong = false, finished = false;
  function judge(v: string, interact = true) {
    const typed = retypeChars(v), wrong = typed.findIndex((c, i) => c !== expected[i]);
    letters.forEach((el, i) => { el.className = i === typed.length ? 'caret' : i < typed.length ? (typed[i] === expected[i] ? 'typed' : 'incorrect') : ''; });
    count.textContent = `${wrong < 0 ? typed.length : wrong} / ${expected.length} 字符`;
    field.setAttribute('aria-invalid', String(wrong >= 0)); feedback!.textContent = wrong < 0 ? '' : `第 ${wrong + 1} 个字符与原文不同，可退格或移回修改。`;
    if (interact) { ctx.saveAnswer(v); if (wrong >= 0 && !wasWrong) ctx.miss('retype'); if (wrong < 0 && typed.length === expected.length && !finished) { finished = true; ctx.pass('retype'); } }
    wasWrong = wrong >= 0;
  }
  const block = (e: Event) => blockInsertion(e, '严格复现不接受粘贴或拖入文字，请手动输入。');
  field.addEventListener('paste', block); field.addEventListener('drop', block);
  field.addEventListener('beforeinput', e => { if (e.inputType.startsWith('insertFromPaste') || e.inputType === 'insertFromDrop') block(e); });
  onCommittedInput(field, v => judge(v)); judge(ctx.answerDraft, false);
}

export function bindCheckpoint(task: Checkpoint, passed: boolean, review: boolean, view: TaskView, ctx: CheckpointContext) {
  const checkpoint = document.getElementById('checkpoint');
  if (!checkpoint) return;
  const hint = document.getElementById('hint'), hintText = document.getElementById('hint-text');
  if (hint && hintText) hint.addEventListener('click', () => { hintText.hidden = !hintText.hidden; hint.setAttribute('aria-expanded', String(!hintText.hidden)); });
  if (passed && !review) return;
  document.querySelectorAll<HTMLElement>('[data-act="practice"]').forEach(el => el.addEventListener('click', () => ctx.start(taskBlanks(task).length ? 'blank' : 'answer')));
  document.querySelectorAll<HTMLElement>('[data-act="explain"]').forEach(el => el.addEventListener('click', () => ctx.start('answer')));
  document.querySelectorAll<HTMLElement>('[data-act="use-blanks"]').forEach(el => el.addEventListener('click', () => ctx.routeTo('blank')));
  document.querySelectorAll<HTMLElement>('[data-act="back-to-answer"]').forEach(el => el.addEventListener('click', () => ctx.routeTo('answer')));
  document.querySelectorAll<HTMLElement>('[data-act="read"]').forEach(el => el.addEventListener('click', () => ctx.read()));
  if (task.kind === 'retype') return bindRetype(task, ctx);
  if (!view.practice) return;
  if (view.route === 'answer') bindComposer(task, ctx); else bindBlanks(task, ctx);
}
