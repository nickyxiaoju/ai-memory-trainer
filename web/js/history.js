/* ---------- J. 本机练习历史 -------------------------------------------- */
/**
 * 原始单文件版本没有任何历史存储：练习结束只有报告页，刷新就没了。
 * 账号体系要展示「累计次数 / 累计字数 / 平均正确率 / 连续打卡」，
 * 所以这一层必须先补上，否则个人中心只能显示云端那几行。
 *
 * 只存统计与关键词明细，绝不存原文全文（隐私承诺里说了不上传原文，
 * 本机也没必要整份留着：文本是用户自己粘的，随时能再来一次）。
 */

/** 安全上下文里用 crypto.randomUUID，普通 http 预览或老浏览器退回手写 v4 */
function newId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch (e) { /* 非安全上下文会抛错，继续走 fallback */ }
  const b = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
         '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
}

/** 本地日期 YYYY-MM-DD：连续打卡的日期边界必须由用户时区决定，不能用 UTC */
function localDateOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 记录名：取源文本开头约 24 字（保留词间空格），个人中心里可以再改成任意名字 */
function titleFromText(raw) {
  const clean = String(raw || '').replace(/[\s　]+/g, ' ').trim();
  if (!clean) return '未命名练习';
  if (clean.length <= 24) return clean;
  const head = clean.slice(0, 24);
  const cut = head.lastIndexOf(' ');
  return (cut >= 12 ? head.slice(0, cut) : head) + '…';
}

const History = {
  /** 把当前 S 里的练习态组装成一条记录（不依赖登录状态） */
  build(completed) {
    const segs = S.segments || [];
    const now = Date.now();
    const totalChars = segs.reduce((a, s) =>
      a + Array.from(s.text).filter(c => !/\s/.test(c)).length, 0);

    // 逐空明细：阶段 4 起 seg.blanks 是练习时真实存在的对象，
    // 尝试次数、首次是否写对、是否用过提示都长在空自己身上，不再从「整段哪些位置红过」反推。
    const blanks = [];
    segs.forEach((seg, si) => {
      (seg.blanks || []).forEach((b, bi) => {
        blanks.push({
          segmentIndex: si,
          blankIndex: bi,
          keyword: b.keyword,
          expected: b.expected,
          charStart: b.start,
          charEnd: b.end,
          // 库里约束是 attempts between 1 and 200：一个字都没填的空也按「1 次未答对」记，
          // 写 0 会让整批 blanks 插不进去（一条越界就全批失败）。
          attempts: Math.max(1, Math.min(200, b.attempts || 0)),
          firstTry: b.firstTry === true,
          hint: !!b.hinted,
          finalText: b.typed == null ? null : String(b.typed).slice(0, 80)
        });
      });
    });

    const totalBlanks = blanks.length;
    const firstTryOk = blanks.filter(b => b.firstTry).length;
    const retryOk = blanks.filter(b => !b.firstTry && b.attempts > 1 && !b.hint).length;
    const hinted = blanks.filter(b => b.hint).length;
    // 按空口径是阶段 4 的正式算法；一段都没挖出空时（纯标点文本）退回字符口径，避免出现 0/0
    const accByBlank = totalBlanks ? Math.round(firstTryOk / totalBlanks * 100) : null;
    const accByChar = totalChars ? Math.max(0, Math.min(100, Math.round(totalChars / (totalChars + S.errTotal) * 100))) : 100;

    return {
      id: newId(),                         // 即 sessions.client_id，迁移去重键
      ts: now,
      localDate: localDateOf(now),
      title: titleFromText($('srcText') ? $('srcText').value : ''),
      totalChars: totalChars,
      segmentCount: segs.length,
      segmentsDone: completed ? segs.length : S.idx,
      totalBlanks: totalBlanks,
      firstTryCorrect: firstTryOk,
      // 下面两项只给报告页的「建议」用，不参与云端 sessions 的列映射
      retryCorrect: retryOk,
      hintedBlanks: hinted,
      accuracy: accByBlank === null ? accByChar : accByBlank,
      accuracyKind: accByBlank === null ? 'char' : 'blank',
      durationMs: Math.max(0, now - (S.startedAt || now)),
      hintUsed: S.hintUsed,
      // 与数据库 quiz_result 的四个取值一一对应，避免把「没练到」写成「答错了」
      quizResult: S.checkpointAt === Infinity ? 'none'
        : S.quizResult === 'ok' ? 'ok'
        : S.quizResult === 'skipped' ? 'skipped'
        : (S.quizDone ? 'wrong' : 'none'),
      completed: !!completed,
      keywords: [...new Set(segs.flatMap(s => s.keywords || []))].slice(0, 40),
      blanks: blanks,
      synced: false,
      cloudId: null
    };
  },

  /** 写入本机（最新的排最前，超出上限丢弃最旧的） */
  record(rec) {
    if (!rec || !rec.id) return false;
    const list = Store.history().filter(r => r && r.id !== rec.id);
    list.unshift(rec);
    return Store.saveHistory(list);
  },

  list() { return Store.history(); },
  byId(id) { return Store.history().find(r => r.id === id) || null; },
  pending() { return Store.history().filter(r => !r.synced); },

  /** 云端写入成功后回填标记，避免下次再重复上传同一条 */
  markSynced(id, cloudId) {
    const list = Store.history();
    const hit = list.find(r => r.id === id);
    if (!hit) return false;
    hit.synced = true;
    hit.cloudId = cloudId || hit.cloudId || null;
    return Store.saveHistory(list);
  },

  clearAll() { Store.remove(Store.key(Store.BASE_HISTORY)); },

  /** 只统计到「连续打卡」所需的本地日期集合（与云端记录合并后再算） */
  localDates() { return Store.history().map(r => r.localDate); }
};
