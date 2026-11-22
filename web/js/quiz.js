/* ---------- F. 闯关测验 ----------------------------------------------- */

/** 本地兜底出题：从已练段落里做一道填空题 */
function localQuiz(practiced) {
  const pool = practiced.filter(p => p.keywords && p.keywords.length);
  const src = pool.length ? pool[Math.floor(Math.random() * pool.length)] : practiced[practiced.length - 1];
  if (!src) return null;
  const kw = (src.keywords && src.keywords[0]) || '';
  if (kw && src.text.includes(kw)) {
    return {
      type: 'fill',
      question: '根据已练内容填空：' + src.text.replace(kw, '______'),
      answer: kw,
      source: src.text,
      options: null
    };
  }
  const tail = Array.from(src.text).slice(-6).join('');
  return { type: 'fill', question: '根据已练内容填空：' + src.text.replace(tail, '______'), answer: tail, source: src.text, options: null };
}

/**
 * 功能 B：让 Groq 基于刚练过的内容出 1 道题（填空或单选）。
 * 单选必须有 4 个选项且 correct 是 options 之一；校验失败则退回本地题。
 */
async function aiQuiz(practiced) {
  const recent = practiced.slice(-3).map((p, i) => (i + 1) + '. ' + p.text).join('\n');
  if (!S.demoMode && $('groqKey').value.trim()) {
    try {
      const j = await groqJSON(
        '你是出题老师，只根据给定材料出 1 道非常简单的回忆题，用于检查是否记住关键信息。',
        '下面是学员刚刚练习过的段落。请出 1 道题，type 只能是 "fill"（填空题）或 "choice"（单选题）。\n' +
        '要求：\n' +
        '1) 题目必须只考关键信息（人名、地名、数字、核心结论），难度低；\n' +
        '2) 如果是 fill，question 中要用 ______ 表示空，answer 是填入的原文片段；\n' +
        '3) 如果是 choice，options 给 4 个短选项，correct 必须是 options 中逐字出现的一项；\n' +
        '4) source 写这道题依据的原文段落。\n' +
        '输出 JSON：{"type":"fill 或 choice","question":"…","answer":"…","options":["…","…","…","…"],"correct":"…","source":"…"}\n\n' +
        '材料：\n' + recent
      );
      if (j && (j.type === 'fill' || j.type === 'choice') && j.question) {
        if (j.type === 'choice') {
          const opts = Array.isArray(j.options) ? j.options.map(o => String(o).trim()).filter(Boolean) : [];
          const correct = String(j.correct || '').trim();
          if (opts.length === 4 && opts.some(o => o === correct)) {
            return { type: 'choice', question: j.question, options: opts, answer: correct, source: String(j.source || '') };
          }
        } else {
          const ans = String(j.answer || '').trim();
          if (ans) return { type: 'fill', question: String(j.question), answer: ans, source: String(j.source || ''), options: null };
        }
      }
    } catch (e) {
      toast('出题接口异常，已改用本地题目：' + friendlyErr(e), 'warn');
    }
  }
  return localQuiz(practiced);
}

/** 判分：填空题宽松匹配（去空格、忽略英文大小写、忽略标点差异） */
/** 填空题判分：只看字母/数字/汉字，忽略空格与全半角标点差异，英文不区分大小写 */
function judgeFill(user, ans) {
  const key = (s) => Array.from(String(s == null ? '' : s)).filter(c => /[\p{L}\p{N}]/u.test(c)).join('').toLowerCase();
  const want = key(ans);
  return want.length > 0 && key(user) === want;
}

/* ---------- 闯关测验 UI ------------------------------------------------ */
let currentQuiz = null;
async function runCheckpointQuiz() {
  const practiced = S.segments.slice(0, S.idx + 1);
  showVeil('AI 正在出题…', '根据你刚刚练过的 ' + practiced.length + ' 段内容生成一道闯关题。');
  let q = null;
  try { q = await aiQuiz(practiced); } catch (e) { toast('出题失败：' + friendlyErr(e), 'err'); }
  hideVeil();
  if (!q) { toast('未能生成题目，已跳过闯关'); S.quizResult = 'skipped'; return; }
  currentQuiz = q;
  $('qBody').textContent = q.question;
  $('qTry').textContent = q.source ? '出处：' + q.source : '';
  const area = $('qArea');
  area.innerHTML = '';
  if (q.type === 'choice') {
    q.options.forEach((o, i) => {
      const lab = document.createElement('label');
      lab.className = 'q-opt';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'qr';
      input.value = o;
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(String.fromCharCode(65 + i) + '. ' + o));
      input.addEventListener('change', () => {
        $$('#qArea .q-opt').forEach(x => x.classList.remove('sel'));
        lab.classList.add('sel');
      });
      area.appendChild(lab);
    });
    $('qSubmit').dataset.kind = 'choice';
  } else {
    area.innerHTML = '<input class="inp" id="qFill" placeholder="把 ______ 处的内容打出来" autocomplete="off" />';
    $('qSubmit').dataset.kind = 'fill';
  }
  $('qSkipBtn').style.display = 'none';   // 仅在多次答错后给出“先跳过”出口，避免演示卡死
  return openQuizVeil();                  // 交给 advanceSegment 等待：答完之前不会翻页
}

/* ---------- 闯关浮层的开关：把「答完才放行」做成 Promise ---------- */
let quizGate = null;        // resolve('ok'|'skipped'|'quit')；题目没能出出来时为 null，调用方直接放行
let quizReturnTo = null;    // 浮层打开前的焦点，关闭后还回去

function openQuizVeil() {
  quizReturnTo = document.activeElement;
  $('quizVeil').classList.add('on');
  const first = $('qArea').querySelector('input');
  if (first) first.focus();
  return new Promise(res => { quizGate = res; });
}

function closeQuizVeil(how) {
  $('quizVeil').classList.remove('on');
  const r = quizGate; quizGate = null;
  if (r) r(how);
  const back = quizReturnTo; quizReturnTo = null;
  if (back && back.focus && document.contains(back)) back.focus();
}

function submitQuiz() {
  const kind = $('qSubmit').dataset.kind;
  let val = '';
  if (kind === 'choice') { const r = document.querySelector('input[name="qr"]:checked'); if (!r) { toast('请先选一个答案', 'warn'); return; } val = r.value; }
  else { val = ($('qFill') || {}).value || ''; if (!val.trim()) { toast('请先填写答案', 'warn'); return; } }

  const ok = kind === 'choice' ? val === currentQuiz.answer : judgeFill(val, currentQuiz.answer);
  if (ok) {
    S.quizResult = 'ok';
    closeQuizVeil('ok');
    toast('闯关成功，后续内容已解锁');
    return;
  }
  S.quizTry = (S.quizTry || 0) + 1;
  $('qTry').textContent = '答错了，再想想～（第 ' + S.quizTry + ' 次尝试）' + (currentQuiz.source ? ' 提示：内容出自「' + currentQuiz.source.slice(0, 40) + '…」' : '');
  if (S.quizTry >= 3) {
    $('qSkipBtn').style.display = '';
    if (kind === 'fill') {
      $('qFill').value = currentQuiz.answer;
      toast('已为你填入正确答案，请点“提交答案”继续');
      $('qTry').textContent = '正确答案：' + currentQuiz.answer;
    } else {
      toast('正确选项是 ' + currentQuiz.answer + '，请选中后提交');
    }
  } else { toast('还差一点，再看一眼题目', 'warn'); }
}
