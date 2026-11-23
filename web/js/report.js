/* ---------- H. 启动练习 / 报告 / 朗读 ---------------------------------- */

async function startPractice() {
  // 练习册有选中项时直接用选中内容（不填文本框）；新输入/OCR 会清掉选中项，于是回退到文本框
  const raw = ((typeof Book !== 'undefined' && Book.selectedText) || $('srcText').value).trim();
  if (!raw) { toast('请先在练习册里选一篇，或粘贴文本 / 上传图片识别文字', 'warn'); return; }
  S.demoMode = $('demoMode').checked;
  saveCfg();
  Store.addToBook(raw);   // 练过的原文收进本机练习册（不上传），下次可直接复用

  const segs = splitSegments(raw);
  if (!segs.length) { toast('文本太短，无法分段', 'warn'); return; }

  // 只重置练习态字段；S.account 由 auth.js 独占，「再练一遍」不得清空账号状态
  S.segments = segs.map(t => ({ text: t, chars: Array.from(t), keywords: null, blanks: [], hintsUsed: 0 }));
  S.idx = 0;
  S.startedAt = Date.now();
  S.errTotal = 0;
  S.hintUsed = 0;
  S.quizTry = 0;
  S.quizDone = !$('optQuiz').checked;
  S.quizResult = null;
  S.inPractice = true;
  S.checkpointAt = Math.max(1, Math.round(S.segments.length * 0.5));
  if (!$('optQuiz').checked) S.checkpointAt = Infinity;

  go('practice');
  $('passage').innerHTML = '<div class="t-loading" role="status">正在准备第一段…</div>';
  $('progLabel').textContent = '共 ' + S.segments.length + ' 段';
  $('kwTags').innerHTML = '';
  $('blankTip').className = 'tip info';
  $('blankTip').textContent = '第一段正在准备，稍等一两秒。';
  clearInterval(S.timerId);
  S.timerId = setInterval(() => { $('stTime').textContent = mmss(Date.now() - S.startedAt); }, 1000);
  $('stTime').textContent = '00:00';
  $('stTyped').textContent = '0';
  $('stErr').textContent = '0';
  $('hintLeft').textContent = HINT_BUDGET;

  // 首段（含 AI 挖空）
  await loadSegment(0);
  toast('共 ' + segs.length + ' 段，把灰框里的空凭记忆填上');
}

function finish() {
  if (!S.inPractice) return;          // 防止连点/回车重复落一份记录
  clearInterval(S.timerId);
  S.inPractice = false;
  // 报告页与历史记录共用同一份数字，避免「屏幕上的正确率」与「存下来的正确率」不一致
  const rec = App.persist(true) || History.build(true);
  const acc = rec.accuracy;
  $('rSeg').textContent = rec.segmentsDone + ' / ' + rec.segmentCount;
  $('rAcc').textContent = acc + '%';
  const bl = rec.totalBlanks | 0, firstOk = rec.firstTryCorrect | 0;
  const retry = rec.retryCorrect | 0, hinted = rec.hintedBlanks | 0;
  if (rec.accuracyKind === 'blank') {
    $('rAccNote').textContent = '正确率按填空计算：本次共 ' + bl + ' 个空，'
      + '第一次离开就写对 ' + firstOk + ' 个，改过之后才写对 ' + retry + ' 个，'
      + '用过提示 ' + hinted + ' 个（提示次数合计 ' + rec.hintUsed + ' 次）。';
  } else {
    $('rAccNote').textContent = '本次没有可统计的空（文本里没挖出可填的实词），正确率暂按写对字数与错误次数计算。';
  }
  $('rTime').textContent = mmss(rec.durationMs);
  $('rHint').textContent = rec.hintUsed;
  $('rQuiz').textContent = rec.quizResult === 'ok' ? '已通过'
    : rec.quizResult === 'skipped' ? '已跳过'
    : rec.quizResult === 'none' ? '未遇到闯关' : '未通过';
  $('reportLead').textContent = acc >= 90 ? '表现非常稳，短时记忆已经转化成较牢固的长时记忆。'
                               : acc >= 70 ? '整体不错，个别字词还需再巩固一轮。'
                               : '别急，记忆本身就是重复提取的过程，我们放慢速度再来一遍。';
  const allKw = rec.keywords || [];
  $('rKws').innerHTML = allKw.length ? allKw.slice(0, 12).map(k => '<span class="kwtag">' + escapeHtml(k) + '</span>').join('')
                                      : '<span class="muted">本次未使用关键词挖空</span>';
  const advice = [];
  const miss = bl - firstOk;
  if (rec.accuracyKind === 'blank') {
    if (miss > 0 && firstOk === 0) advice.push('这次空几乎都没第一次就写对，建议把每段长度调小一档，先把「一次记一小块」练稳。');
    else if (miss > firstOk) advice.push('有 ' + miss + ' 个空是改过或靠提示才填上的，下一轮只看这些词、不回看原文，先建立提取线索。');
    else if (bl && firstOk / bl >= 0.8) advice.push('大多数空第一次就写对了，可以试着把每段长度调大一档，提高单次练习的信息量。');
    if (hinted > 0) advice.push('其中 ' + hinted + ' 个空用了逐字提示，下一轮把提示留到最后一次机会再用，让回忆先跑一遍。');
    if (retry > 0) advice.push('有 ' + retry + ' 个空是删掉重打才写对的，说明字形已经接近了，睡前再默一遍这几个词就能固化。');
  } else if (acc < 80) advice.push('把错误集中的段落单独再默写一遍，第二轮只看关键词、不看原文。');
  if (rec.hintUsed > 3) advice.push('提示用得较多，建议下一轮减少提示，并把每段先用朗读听一遍再默写。');
  advice.push('间隔复习效果更好：10 分钟后再练一次，今晚睡前练第三次。');
  if (rec.totalChars > 300) advice.push('内容较长，可以拆成两次练习，每次 10–15 分钟更利于保持注意力。');
  advice.push('长辈练习时建议开启「大字模式 + 自动朗读」，并由家人陪同，把内容与日常生活联系起来。');
  $('rAdvice').innerHTML = advice.map(a => '<li>' + escapeHtml(a) + '</li>').join('');
  go('report');
}

/** 适老化辅助：朗读本段（中文语音、慢速） */
function speak(text) {
  if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读', 'warn'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = $('optBig').checked ? 0.75 : 0.95;
  u.pitch = 1;
  const v = window.speechSynthesis.getVoices().find(x => /zh|Chinese/i.test(x.lang));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}
