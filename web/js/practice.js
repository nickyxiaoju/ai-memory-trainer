/* ---------- G. 行内挖空与练习主流程 ---------------------------------- */
/**
 * 阶段 4 的默写模型：原文照常显示，只在关键词处留一个真正可编辑的空。
 * 旧版是「整段抄进文本框 + 逐位比对」，判定里混着「长度必须相等」「每个位置都对齐」
 * 这类全局条件，于是出现过「提示已写对 76 / 76 却怎么都过不去」的死锁。
 * 新模型每个空各判各的：段落完成条件 = 所有空都变绿，
 * 而每个空都看得见、改得了、还能一键定位，结构上不存在过不去的状态。
 */

const HINT_BUDGET = 3;    // 每段提示次数（旧版用全局计数，与按钮上「剩 N 次」的文案自相矛盾）

let curSeg = null;        // 当前段落对象
let activeBlank = null;   // 当前聚焦的空：提示与 Enter 都以它为锚点
let advancing = false;    // 载入/闯关进行中：拦住连点与 Enter 抢跑

/* ---------- 空位的归一与判定 ------------------------------------------ */

/**
 * 输入归一：NFKC 把全角字母数字与全角空格折成半角，各类空白（含 NBSP、零宽）并成一个空格。
 * 这一步只影响显示宽度与「剩余部分」的切分，判定本身还要过 judgeFill，
 * 所以标点写全角还是半角、空格多打一个都永远不会成为过不去的理由。
 */
function normBlank(v) {
  return String(v == null ? '' : v)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 空位期望文本的字数（按码位算，emoji 代理对不会算成两个字） */
function blankLen(b) { return Array.from(String(b.expected)).length; }

/** 加权宽度：汉字一个字约 1em，拉丁字母约 0.62em，混排按字符累加 */
function blankEm(s) {
  let em = 0;
  Array.from(String(s)).forEach(c => { em += c.charCodeAt(0) <= 0x2FF ? 0.62 : 1.05; });
  return em;
}

/**
 * 空位宽度取「剩余待填」与「已打进来的字」里更宽的那个，并封顶在 24em。
 * 只按关键词定宽会把打多的字裁成半个笔画（「这里故意写错」只显示「这里故」），
 * 用户看不见自己写了什么，就改不错——所以宽度必须跟着内容长。
 */
function sizeBlank(b) {
  if (!b.el) return;
  const cut = Math.max(0, Math.min(b.hintChars || 0, blankLen(b)));
  const rest = Array.from(String(b.expected)).slice(cut).join('');
  const em = Math.max(blankEm(rest), blankEm(normBlank(b.el.value)));
  b.el.style.width = Math.min(24, Math.max(2.4, em + 0.7)).toFixed(2) + 'em';
}

/**
 * 单个空的判定。整词命中算对；给过提示之后，只补「提示前缀之外的剩余」也算对，
 * 否则用户对着「洞庭」的提示只敢打「湖」，反而被红叉拦回去——那也是一种人为死锁。
 */
function blankAccepts(b, value) {
  const v = normBlank(value);
  if (!v) return false;
  if (judgeFill(v, b.expected)) return true;
  const total = blankLen(b);
  const cut = Math.max(0, Math.min(b.hintChars || 0, total - 1));
  if (!cut) return false;
  return judgeFill(v, Array.from(String(b.expected)).slice(cut).join(''));
}

/* ---------- 渲染 ------------------------------------------------------ */

/** 把段落铺成课本内页：静态文字用文本节点，关键词区间换成一个行内输入框 */
function renderPassage() {
  curSeg = S.segments[S.idx];
  activeBlank = null;
  const box = $('passage');
  box.innerHTML = '';
  const line = document.createElement('div');
  line.className = 't-line is-current';
  const chars = curSeg.chars;
  let pos = 0;
  const putText = (from, to) => {
    if (to <= from) return;
    const t = document.createElement('span');
    t.className = 't-text';
    t.textContent = chars.slice(from, to).join('');   // 文本节点：不解析 HTML，无需转义
    line.appendChild(t);
  };
  curSeg.blanks.forEach(b => {
    putText(pos, b.start);
    line.appendChild(makeBlankSlot(b));
    pos = b.end;
  });
  putText(pos, chars.length);
  if (!line.childNodes.length) {                      // 整段都是空位的极端情况，别让行高塌成一条线
    const t = document.createElement('span');
    t.className = 't-text';
    t.textContent = ' ';
    line.appendChild(t);
  }
  box.appendChild(line);

  $('progLabel').textContent = '第 ' + (S.idx + 1) + ' / ' + S.segments.length + ' 段';
  $('progBar').style.width = Math.round(S.idx / S.segments.length * 100) + '%';
  // 关键词列表不再显示：旧版这里直接把答案列在段落下面，默写题变成了抄写题。
  $('kwTags').innerHTML = curSeg.blanks.length
    ? '<span class="muted">本段 ' + curSeg.blanks.length + ' 个空凭记忆填写</span>'
    : '<span class="muted">本段没有可挖空的实词，直接下一段</span>';
  updateHintCounter();
  updateStats();
  if ($('optSpeak').checked) speak(curSeg.text);
}

/** 一个空位 = 只读提示前缀 + 行内输入框；提示 progressively 长出来，输入框同步变窄 */
function makeBlankSlot(b) {
  const slot = document.createElement('span');
  slot.className = 't-slot';

  const hint = document.createElement('span');
  hint.className = 't-hint';
  hint.hidden = true;
  b.hintEl = hint;

  const inp = document.createElement('input');
  inp.className = 't-blank is-empty';
  inp.type = 'text';
  inp.autocomplete = 'off';
  inp.autocapitalize = 'off';
  inp.setAttribute('spellcheck', 'false');
  inp.setAttribute('inputmode', 'text');
  // aria-label 只报位置和字数，绝不念出关键词：念出来就是把答案读给了读屏用户
  inp.setAttribute('aria-label', '第 ' + (b.segIdx + 1) + ' 段第 ' + (b.idx + 1) + ' 空，需填 ' + blankLen(b) + ' 个字');

  inp.addEventListener('compositionstart', () => { b.composing = true; });
  // 组合期间不判定：中文输入法的半候选会被判成红叉，用户还没选完字就被标错
  inp.addEventListener('compositionend', () => { b.composing = false; rejudgeBlank(b); });
  inp.addEventListener('input', (e) => { if (!b.composing && !(e && e.isComposing)) rejudgeBlank(b); });
  inp.addEventListener('focus', () => { activeBlank = b; updateHintCounter(); });
  inp.addEventListener('blur', () => { commitBlank(b); });
  inp.addEventListener('keydown', (e) => onBlankKey(e, b));

  slot.appendChild(hint);
  slot.appendChild(inp);
  b.el = inp;
  sizeBlank(b);
  return slot;
}

/* ---------- 判定、上色与尝试计数 -------------------------------------- */

/**
 * 实时判定：只改这一个空的类名，不重排整段（低端机连续打字不卡）。
 * silent=true 用于批量复核（切段、下一段前），不触发自动跳格与播报。
 */
function rejudgeBlank(b, silent) {
  const was = b.state;
  const v = normBlank(b.el ? b.el.value : '');
  if (v) b.typed = b.el.value;
  b.state = !v ? 'empty' : (blankAccepts(b, b.el ? b.el.value : '') ? 'ok' : 'bad');
  // 一路输入就对、从没离开过这个空（例如输入法确认候选后直接写完）：补一次尝试，
  // 否则 firstTry 停在 null，这条空既不算首次对也不算改过才对，正确率会凭空偏低。
  // 同时把 lastCommit 记成当前值，让随后的失焦被去重掉，免得「一次写对」被计成两次尝试。
  if (b.state === 'ok' && b.attempts === 0) { b.attempts = 1; b.firstTry = !b.hinted; b.lastCommit = v; }
  paintBlank(b);
  sizeBlank(b);
  if (b.state === 'ok' && was !== 'ok' && !silent) autoNext(b);   // 播报交给 #blankTip，它本来就是 aria-live 区
  if (!silent) { updateStats(); updateSegTip(); }
}

/** 写对后置为只读而不是禁用：内容还在、Tab 仍能停上来，但不会被事后误改 */
function paintBlank(b) {
  const el = b.el;
  if (!el) return;
  el.classList.remove('is-ok', 'is-bad', 'is-empty');
  el.classList.add('is-' + b.state);
  el.readOnly = (b.state === 'ok');
  el.setAttribute('aria-invalid', b.state === 'bad' ? 'true' : 'false');
}

/**
 * 一次「尝试」= 用户离开这个空（失焦、回车、点下一段）时它非空，且写法与上次判定过的不同。
 * 逐字输入过程中的中间态不计数：否则任何 3 字词都要背 3 次「错」，首次正确率会假性归零。
 * 靠提示才填上的空不算首次正确：报告的三个桶（首次就对 / 改过才对 / 用过提示）要能相加而不重复计。
 */
function commitBlank(b) {
  if (!b || !b.el) return;
  const v = normBlank(b.el.value);
  if (!v) return;
  if (b.lastCommit === v) return;
  b.lastCommit = v;
  b.attempts++;
  if (b.attempts === 1) b.firstTry = blankAccepts(b, b.el.value) && !b.hinted;
  if (!blankAccepts(b, b.el.value)) S.errTotal++;
  updateStats();
}

/* ---------- 跳转与推进 ------------------------------------------------ */

function prefersStill() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function focusBlank(b, block) {
  if (!b || !b.el) return;
  b.el.focus();
  try { b.el.scrollIntoView({ block: block || 'center', behavior: prefersStill() ? 'auto' : 'smooth' }); } catch (e) { /* 老浏览器只认布尔参数 */ }
}

/** 从 from 之后找第一个还没写对的空（环形找，允许从中间接着填） */
function nextOpenBlank(from) {
  const list = (curSeg && curSeg.blanks) || [];
  if (!list.length) return null;
  const i = from ? list.indexOf(from) : -1;
  for (let k = 1; k <= list.length; k++) {
    const b = list[((i + k) % list.length + list.length) % list.length];
    if (b.state !== 'ok') return b;
  }
  return null;
}

function prevBlankOf(from) {
  const list = (curSeg && curSeg.blanks) || [];
  const i = list.indexOf(from);
  if (i <= 0) return null;
  return list[i - 1];
}

/** 写完一个空自动跳到下一个没写对的；本段写完则留在原地，等 Enter 或点下一段 */
function autoNext(b) {
  if (document.activeElement !== b.el) return;
  const nxt = nextOpenBlank(b);
  if (nxt) focusBlank(nxt, 'nearest');
}

async function onBlankKey(e, b) {
  if (e.key !== 'Enter') return;
  if (e.isComposing || b.composing || e.keyCode === 229) return;   // 输入法确认候选的回车不算跳格
  e.preventDefault();
  if (uiBlocked()) return;
  if (e.shiftKey) { const p = prevBlankOf(b); if (p) focusBlank(p, 'center'); else toast('这已经是本段第一个空', 'warn'); return; }
  commitBlank(b);
  rejudgeBlank(b, true);
  if (!segReady()) {
    const nxt = nextOpenBlank(b) || b;
    if (nxt !== b) focusBlank(nxt, 'center');
    toast(nxt.state === 'bad' ? '这个空还不对，再看看上文' : '已跳到下一个待填写的空', 'warn');
    return;
  }
  await advanceSegment();
}

/** 段落完成条件：只看用户可直接编辑的空。空段落视为已完成（段里确实没东西可填）。 */
function segReady() {
  if (!curSeg) return false;
  return curSeg.blanks.every(b => b.state === 'ok');
}

/** 遮罩/载入/闯关进行中：Enter 与按钮此时一律不推进，否则会出现「答题时段落已经翻页」 */
function uiBlocked() {
  return advancing ||
    $('veil').classList.contains('on') ||
    $('quizVeil').classList.contains('on') ||
    $('migrateVeil').classList.contains('on');
}

/** 进入下一段（含 50% 闯关拦截）：按钮与 Enter 共用这一个入口，不可能触发两次 */
async function advanceSegment() {
  if (!curSeg || uiBlocked()) return;
  commitBlank(activeBlank);
  curSeg.blanks.forEach(b => rejudgeBlank(b, true));     // 以最终值统一复核，只改类名不动结构
  if (!segReady()) {
    const open = curSeg.blanks.filter(b => b.state !== 'ok');
    const names = open.slice(0, 4).map(b => b.keyword).join('、');
    focusBlank(open[0], 'center');
    updateStats();
    updateSegTip();
    toast('还有 ' + open.length + ' 个空未写对：' + names + (open.length > 4 ? ' 等' : '') + '，已定位到第一个', 'warn');
    return;
  }
  if (S.idx === S.segments.length - 1) { finish(); return; }

  // 功能 B：完成约一半时暂停并闯关，答对/跳过之后才载入下一段
  if ($('optQuiz').checked && !S.quizDone && S.idx + 1 >= S.checkpointAt) {
    S.quizDone = true;
    advancing = true;
    try {
      const gate = await runCheckpointQuiz();
      if (gate) await gate;                              // gate 为 null 表示这道题没能出出来，直接放行
    } finally { advancing = false; }
    if (!$('screen-practice').classList.contains('on')) return;   // 期间已经退出练习
    $('btnNext').focus();                                // 浮层关掉后把焦点还给拦下它的那个按钮
  }
  await loadSegment(S.idx + 1);
}

/**
 * 载入第 i 段：先取关键词，取不到才现挖，最后一次性渲染。
 * 渲染前绝不留任何 disabled 的输入区——旧版先禁用再 await，AI 一抛错就把用户锁在「准备中」。
 */
async function loadSegment(i) {
  S.idx = i;
  const seg = S.segments[i];
  advancing = true;
  activeBlank = null;
  $('passage').innerHTML = '<div class="t-loading" role="status">正在准备第 ' + (i + 1) + ' 段的挖空…</div>';
  $('btnNext').setAttribute('aria-disabled', 'true');
  $('btnNext').classList.remove('is-ready');
  $('progLabel').textContent = '第 ' + (i + 1) + ' / ' + S.segments.length + ' 段';
  tip('正在为本段挑选关键词…', 'info');

  if (!seg.keywords) {
    try {
      seg.keywords = (await aiKeywords(seg.text)) || [];
    } catch (e) {
      // aiKeywords 内部已经退回本地算法，这一层兜的是它自身的意外（缓存、DOM 缺失等）：
      // 任何情况下段落都要能渲染出来，练习不能被一句报错卡死。
      seg.keywords = localKeywords(seg.text) || [];
      toast('挖空已降级为本地算法：' + friendlyErr(e), 'warn');
    }
  }
  seg.blanks = $('optCloze').checked
    ? buildBlanks(seg.text, seg.keywords, i)
    : rangesToBlanks(clauseRanges(seg.text), seg.text, i);
  if (!seg.blanks.length) seg.blanks = rangesToBlanks(clauseRanges(seg.text), seg.text, i);  // 一段连标点都用不上时退回整段默写，免得白送一段
  renderPassage();
  advancing = false;

  const first = curSeg.blanks[0];
  if (first) focusBlank(first, 'center'); else $('btnNext').focus();
  updateSegTip();
}

/* ---------- 提示（逐字给前缀，不再整段显形） -------------------------- */

function hintOnce() {
  if (!curSeg || uiBlocked()) return;
  const list = curSeg.blanks;
  if (!list.length) { toast('这一段没有需要填的空', 'warn'); return; }
  const b = (activeBlank && activeBlank.state !== 'ok') ? activeBlank : nextOpenBlank(null);
  if (!b) { toast('这一段已经全部写对，直接下一段', 'warn'); return; }
  if (curSeg.hintsUsed >= HINT_BUDGET) { toast('这一段的 ' + HINT_BUDGET + ' 次提示都用完了，剩下的空先自己回想一遍', 'warn'); return; }
  const total = blankLen(b);
  if (b.hintChars >= Math.max(1, total - 1)) {
    toast('这个空已经提示到最后一个字之前，再给就抄答案了', 'warn');
    return;
  }
  curSeg.hintsUsed++;
  S.hintUsed++;                       // 全局累计，报告的「提示次数」用它
  b.hintChars++;
  b.hinted = true;
  paintHint(b);
  updateHintCounter();
  focusBlank(b, 'nearest');
  const shown = Array.from(String(b.expected)).slice(0, b.hintChars).join('');
  tip('提示：这个空开头是「' + shown + '」，后面的 ' + (blankLen(b) - b.hintChars) + ' 个字请自己补全；只补剩余部分也算对。', 'warn');
}

/** 提示前缀挂在空的左边，输入框随之变窄；补剩余部分也判对，见 blankAccepts */
function paintHint(b) {
  const total = blankLen(b);
  const cut = Math.max(0, Math.min(b.hintChars || 0, total));
  if (b.hintEl) {
    b.hintEl.textContent = cut > 0 ? Array.from(String(b.expected)).slice(0, cut).join('') : '';
    b.hintEl.hidden = cut <= 0;
  }
  if (b.el) {
    b.el.classList.toggle('t-blank--hinted', cut > 0);
    sizeBlank(b);
  }
}

function updateHintCounter() {
  $('hintLeft').textContent = Math.max(0, HINT_BUDGET - ((curSeg && curSeg.hintsUsed) || 0));
}

/* ---------- 底部提示条与统计 ------------------------------------------ */

function tip(msg, kind) {
  const el = $('blankTip');
  if (!el) return;
  el.className = 'tip ' + (kind || 'info');
  el.textContent = msg;
}

/**
 * 底部提示条：#blankTip 本身就是 aria-live=polite 区域，
 * 所以状态变化直接写进它就够了，不再另设一个隐藏播报区（两处同时播报会念两遍）。
 */
function updateSegTip() {
  if (!curSeg) return;
  const open = curSeg.blanks.filter(b => b.state !== 'ok');
  if (!curSeg.blanks.length) { tip('本段没有可挖空的实词，按 Enter 或点「下一段」继续。', 'good'); return; }
  if (!open.length) { tip('本段 ' + curSeg.blanks.length + ' 个空全部写对，按 Enter 或点「下一段」继续。', 'good'); return; }
  const bad = open.filter(b => b.state === 'bad').length;
  if (bad) { tip('还需修改 ' + bad + ' 个空；点「提示」可以一次多给一个字。', 'warn'); return; }
  tip('还有 ' + open.length + ' 个空待填写，绿色表示已写对。', 'info');
}

function updateStats() {
  if (!curSeg) return;
  const ok = curSeg.blanks.filter(b => b.state === 'ok').length;
  $('stTyped').textContent = ok;
  $('stErr').textContent = S.errTotal;
  const ready = segReady();
  // aria-disabled 而不是原生 disabled：原生 disabled 的按钮不派发 click，
  // 旧版「点了没反应也没提示」就是这么来的。现在点下去永远有反馈。
  $('btnNext').setAttribute('aria-disabled', ready ? 'false' : 'true');
  $('btnNext').classList.toggle('is-ready', ready);
}
