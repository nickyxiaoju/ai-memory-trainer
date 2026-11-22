import type { Checkpoint } from './types';
import { icon } from './ui.ts';
import { checkAnswer, retypeChars } from './validation.ts';

export function AnswerEditor() { return '<label class="sr-only" for="answer">你的理解</label><textarea class="editor" id="answer" rows="2" placeholder="用自己的话写下理解…"></textarea>'; }
export function RetypingExercise(target: string) {
  return `<div class="target" aria-label="待复现原文：${escapeHtml(target)}"></div><label class="sr-only" for="retype">逐字复现输入</label><textarea id="retype" class="editor" rows="2" autocomplete="off" spellcheck="false" placeholder="在这里逐字输入原文…"></textarea><div class="retype-status"><span id="char-count"></span><span>标点、空格、大小写须一致；全角英数、ASCII 符号和空格可用半角。</span></div>`;
}
export function UnlockTransition(last: boolean) { return `<div class="unlock-row"><span>${icon('check')} ${last ? '已通过本节检查点' : '已通过，下一节已解锁'}</span><button class="text-button" data-act="next">${last ? '查看总结' : '继续阅读'} ${icon('arrow',15)}</button></div>`; }
export function LearningCheckpoint(task: Checkpoint, passed: boolean, review: boolean, last: boolean) {
  return `<section id="checkpoint" class="checkpoint" aria-label="阅读检查点" tabindex="-1"><div class="cp-meta"><span class="cp-symbol">${icon(task.kind === 'answer' ? 'edit' : 'keyboard',15)}</span><b>阅读检查点</b><i></i>${task.kind === 'answer' ? '理解题' : '原文复现'}${passed && !review ? `<button class="mini-link push" data-act="retry">${icon('redo',13)} 重练</button>` : ''}</div><h3>${escapeHtml(task.prompt)}</h3>
    ${passed && !review ? UnlockTransition(last) : (task.kind === 'answer' ? AnswerEditor() + `<div class="cp-actions"><button id="submit-answer" class="primary" disabled>验证回答 ${icon('enter',15)}</button><button id="hint" class="text-button" aria-expanded="false">${icon('bulb',15)} 提示</button><span class="key-hint">Enter 提交 · Shift+Enter 换行</span></div><p class="hint-text" id="hint-text" hidden>${escapeHtml(task.hint)} <button class="mini-link" data-act="source">回到原文 ${icon('next',12)}</button></p>` : RetypingExercise(task.target)) + `<p class="feedback" id="feedback" role="status" aria-live="polite"></p>${passed ? '<button class="mini-link" data-act="end-review">结束重练，保留原进度</button>' : `<div class="locked-line">${icon('lock',14)} ${last ? '通过后即可完成本章' : '通过这个检查点，继续下一节'}</div>`}`}</section>`;
}
export function bindCheckpoint(task: Checkpoint, draft: string, save: (v: string) => void, pass: () => void, miss: () => void) {
  const feedback = document.querySelector<HTMLElement>('#feedback');
  if (!feedback) return;
  const field = document.querySelector<HTMLTextAreaElement>('.editor')!; field.value = draft;
  let composing = false;
  if (task.kind === 'answer') {
    const submit = document.querySelector<HTMLButtonElement>('#submit-answer')!; submit.disabled = !draft.trim();
    field.oninput = () => { save(field.value); submit.disabled = !field.value.trim() || field.readOnly; };
    field.addEventListener('compositionstart', () => { composing = true; }); field.addEventListener('compositionend', () => { composing = false; });
    field.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing && e.keyCode !== 229) { e.preventDefault(); submit.click(); } };
    submit.onclick = () => {
      if (composing || field.readOnly || !field.value.trim()) return;
      field.readOnly = true; submit.disabled = true; submit.textContent = '正在核对…';
      setTimeout(() => {
        if (!field.isConnected) return;
        const r = checkAnswer(field.value); if (r.ok) { pass(); return; }
        miss(); feedback.textContent = r.message; field.readOnly = false; submit.disabled = false; submit.innerHTML = `重新验证 ${icon('enter',15)}`; field.focus({ preventScroll: true });
      }, 180);
    };
    const hint = document.getElementById('hint')!, text = document.getElementById('hint-text')!;
    hint.onclick = () => { text.hidden = !text.hidden; hint.setAttribute('aria-expanded', String(!text.hidden)); };
  } else {
    const expected = retypeChars(task.target), target = document.querySelector('.target')!, count = document.getElementById('char-count')!;
    const letters = Array.from(task.target.normalize('NFC'), c => { const el = document.createElement('span'); el.textContent = c; el.setAttribute('aria-hidden','true'); return el; }); target.replaceChildren(...letters);
    let wasWrong = false, finished = false;
    function judge(v: string, interact = true) {
      const typed = retypeChars(v), wrong = typed.findIndex((c, i) => c !== expected[i]);
      letters.forEach((el, i) => { el.className = i === typed.length ? 'caret' : i < typed.length ? (typed[i] === expected[i] ? 'typed' : 'incorrect') : ''; });
      count.textContent = `${wrong < 0 ? typed.length : wrong} / ${expected.length} 字符`;
      field.setAttribute('aria-invalid', String(wrong >= 0)); feedback!.textContent = wrong < 0 ? '' : `第 ${wrong + 1} 个字符与原文不同，可退格或移回修改。`;
      if (interact) { save(v); if (wrong >= 0 && !wasWrong) miss(); if (wrong < 0 && typed.length === expected.length && !finished) { finished = true; pass(); } }
      wasWrong = wrong >= 0;
    }
    function block(e: Event) { e.preventDefault(); feedback!.textContent = '严格复现不接受粘贴或拖入文字，请手动输入。'; }
    field.onpaste = block; field.ondrop = block;
    field.onbeforeinput = e => { if (e.inputType.startsWith('insertFromPaste') || e.inputType === 'insertFromDrop') block(e); };
    onCommittedInput(field, v => judge(v)); judge(draft, false);
  }
}
