/* ---------- I. 检查点与艾宾浩斯复习调度 -------------------------------- */
/**
 * 阶段 3：把「已经写对的段落」变成可复习的检查点，再按遗忘曲线安排下次时间。
 * 全程走规则、不叫大模型：检查点复用 keywords.js 的 localKeywords，题干就是
 * 「把关键词挖掉的原句」，答案就是那个关键词——和练习页的挖空同源，
 * 复习题不可能跟刚练过的内容对不上。
 *
 * 间隔阶梯 1→2→4→7→15：「记得」往上一档（封顶 15），「忘了」回到 1。
 * 重新学同一篇教材不会把已排好的间隔冲回 1 天，否则每翻一遍课本，
 * 自己辛苦攒出来的复习计划就被清空了。
 */

const DAY_MS = 86400000;
const INTERVAL_LADDER = [1, 2, 4, 7, 15];
const REVIEW_DAY_KEY = 'folio.review.day';     // 只存「今天做完哪些 id」，刷新后进度条不归零
const REVIEW_CLOCK_KEY = 'folio.review.clock';  // 调试时钟拨快了多少，刷新后不回退到今天

/**
 * 调试时钟：排期与到期判断一律取 reviewNow()，不再直接用 Date.now()。
 * 上一版「模拟过一天」是把记录的 nextReviewAt 往过去挪，但每次「记得」又按真实的
 * now 重新排到未来，两个偏移互相抵消，连点看着就像没生效。拨快时钟只改「现在」，
 * 记录本身一个字都不动，演示前删掉调试入口，排期不会留下历史伤痕。
 */
let clockOffsetMs = 0;

function reviewNow() { return Date.now() + clockOffsetMs; }

/** 从本机读回拨快量，刷新页面也能接着往后面几天测 */
function loadClock() {
  let n = 0;
  try { n = Number(localStorage.getItem(REVIEW_CLOCK_KEY)); } catch (e) { n = 0; }
  clockOffsetMs = Number.isFinite(n) ? n : 0;
  return clockOffsetMs;
}

function saveClock() {
  try { localStorage.setItem(REVIEW_CLOCK_KEY, String(clockOffsetMs)); } catch (e) { console.warn('调试时钟没存住', e); }
}

/** 模拟「今天」的 23:59:59.999：nextReviewAt 落在这一天之内就算今日待复习 */
function endOfReviewDay() {
  const d = new Date(reviewNow());
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 模拟「今天」的 00:00：算「今天新学了几项」用，和 endOfReviewDay 同一条时间轴 */
function startOfReviewDay() {
  const d = new Date(reviewNow());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 「11月25日」这样的到期日读数：让「刚学的东西去哪了」当场看得见 */
function dueDateLabel(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/** 「第几天」的键跟着模拟时钟换天，否则做过的卡会被 done 名单一直挡在队列外 */
function dayKey() {
  const d = new Date(reviewNow());
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** 往上一档；当前值不在阶梯上时取比它大的最小档，再不行封顶 15 */
function nextInterval(cur) {
  const up = INTERVAL_LADDER.find(v => v > cur);
  return up || INTERVAL_LADDER[INTERVAL_LADDER.length - 1];
}

/** 排序：先错过的，其次到得早的 */
function dueOrder(a, b) {
  const wrongA = (a.wrongCount | 0) > 0 ? 0 : 1;
  const wrongB = (b.wrongCount | 0) > 0 ? 0 : 1;
  return (wrongA - wrongB) || (a.nextReviewAt - b.nextReviewAt);
}

function reviewText(tag, cls, txt) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = txt == null ? '' : String(txt);   // 题干来自用户粘贴的原文，只走 textContent
  return el;
}

function reviewBtn(id, cls, txt, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.id = id;
  b.textContent = txt;
  b.onclick = onClick;
  return b;
}

const Review = {
  queue: [],          // 今日待复习记录
  index: new Map(),   // checkpointId -> {question, answer, docTitle, segOrder}
  scheduled: 0,       // 表里全部记录数
  learnedToday: 0,    // 今天新学、还没复习过的检查点数
  nextDueAt: 0,       // 最近一次未到期的时间戳（0 = 没有）
  pos: 0,             // 当前卡片
  revealed: false,    // 本题答案是否已展开
  day: { key: '', done: [] },

  /* ---------- 检查点：与练习页共用同一批关键词 ---------- */

  buildCheckpoints(doc) {
    const out = [];
    (doc.segments || []).forEach((seg, i) => {
      const segId = seg.id || (doc.docId + '-s' + i);
      localKeywords(seg.text).slice(0, 2).forEach((kw, k) => {
        out.push({
          id: doc.docId + '-c' + i + '-' + k,
          segmentId: segId,
          docId: doc.docId,
          question: seg.text.replace(kw, '______'),
          answer: kw
        });
      });
    });
    return out;
  },

  /** 阶段 2 生成的教材里没有 checkpoints，第一次打开时按同一套规则补上并存回 */
  async ensureCheckpoints(doc) {
    if (Array.isArray(doc.checkpoints) && doc.checkpoints.length) return doc.checkpoints;
    doc.checkpoints = this.buildCheckpoints(doc);
    try { await DB.saveDocument(doc); } catch (e) { console.warn('checkpoints 回写失败', e); }
    return doc.checkpoints;
  },

  /* ---------- 学完落库 ---------- */

  /**
   * 段落所有空写对 = 该段的检查点各学完一次。
   * 新记录：learnedAt=现在，interval=1，nextReviewAt=明天同一时间。
   * 已存在的记录一律不动间隔：重学不该把 7 天档打回 1 天。
   */
  async onSegmentDone(segIdx) {
    if (!S.docId || !Array.isArray(S.checkpoints) || !S.checkpoints.length) return 0;
    const seg = S.segments && S.segments[segIdx];
    if (!seg) return 0;
    const cps = S.checkpoints.filter(c => c.segmentId === seg.id);
    if (!cps.length) return 0;
    const now = reviewNow();
    let created = 0;
    for (const cp of cps) {
      let rec = null;
      try { rec = await DB.getReview(cp.id); } catch (e) { rec = null; }
      if (rec && rec.nextReviewAt) continue;
      try {
        await DB.saveReview({
          checkpointId: cp.id,
          docId: S.docId,
          learnedAt: now,
          interval: 1,
          nextReviewAt: now + DAY_MS,
          correctCount: 0,
          wrongCount: 0,
          lastResult: 'learned'
        });
        created++;
      } catch (e) {
        toast('复习计划没存住：' + (e && e.message ? e.message : e), 'err');
        return created;
      }
    }
    if (created) toast('本段 ' + created + ' 个检查点已排进复习计划，明天开始复习', 'good');
    return created;
  },

  /* ---------- 今日队列 ---------- */

  loadDay() {
    const key = dayKey();
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(REVIEW_DAY_KEY) || 'null'); } catch (e) { raw = null; }
    if (raw && raw.key === key && Array.isArray(raw.done)) return raw;
    return { key: key, done: [] };
  },

  saveDay() {
    try { localStorage.setItem(REVIEW_DAY_KEY, JSON.stringify(this.day)); } catch (e) { console.warn('今日进度没存住', e); }
  },

  /**
   * 把复习面板与调试时钟搬进当前屏的宿主节点。
   * 全页只有一份这些节点，靠 appendChild 移动：两栏显示的永远是同一份状态，
   * 不可能出现「工作台做了两张、练习屏还挂着三张」的错位。
   */
  mount(screen) {
    const practice = screen === 'practice';
    const rHost = $(practice ? 'reviewHostPractice' : 'reviewHostWb');
    const dHost = $(practice ? 'debugHostPractice' : 'debugHostWb');
    const panel = $('reviewPanel');
    const bar = $('debugBar');
    if (rHost && panel && panel.parentNode !== rHost) rHost.appendChild(panel);
    if (dHost && bar && bar.parentNode !== dHost) dHost.appendChild(bar);
  },

  async refresh() {
    loadClock();   // 先恢复调试时钟，loadDay 的「第几天」要用模拟日期算
    const [revs, docs] = await Promise.all([DB.listReviews(), DB.listDocuments()]);
    this.index = new Map();
    docs.forEach(d => (d.checkpoints || []).forEach((c, i) => {
      this.index.set(c.id, { question: c.question, answer: c.answer, docTitle: d.title, segOrder: i });
    }));
    this.scheduled = revs.length;
    this.day = this.loadDay();
    const eod = endOfReviewDay();
    this.queue = revs
      .filter(r => r && r.checkpointId && r.nextReviewAt <= eod)
      .filter(r => !this.day.done.includes(r.checkpointId))
      .sort(dueOrder);
    // 今天新学的、以及最近一次还没到期的时间：空队列也要说清「东西去哪了」
    const sod = startOfReviewDay();
    this.learnedToday = revs.filter(r => r && r.lastResult === 'learned' && r.learnedAt >= sod).length;
    const later = revs.filter(r => r && r.nextReviewAt > eod).sort((a, b) => a.nextReviewAt - b.nextReviewAt);
    this.nextDueAt = later.length ? later[0].nextReviewAt : 0;
    this.pos = 0;
    this.revealed = false;
    this.render();
  },

  /* ---------- 打分与推进 ---------- */

  async grade(remembered) {
    const rec = this.queue[this.pos];
    if (!rec) return;
    const now = reviewNow();
    if (remembered) {
      rec.correctCount = (rec.correctCount | 0) + 1;
      rec.interval = nextInterval(rec.interval || 1);
      rec.lastResult = 'ok';
    } else {
      rec.wrongCount = (rec.wrongCount | 0) + 1;
      rec.interval = 1;
      rec.lastResult = 'again';
    }
    rec.lastReviewedAt = now;
    rec.nextReviewAt = now + rec.interval * DAY_MS;   // 下次 = 现在 + 新间隔
    try {
      await DB.saveReview(rec);
    } catch (e) {
      toast('这次作答没存住：' + (e && e.message ? e.message : e), 'err');
      return;
    }
    if (!this.day.done.includes(rec.checkpointId)) this.day.done.push(rec.checkpointId);
    this.saveDay();
    this.queue.splice(this.pos, 1);                   // 做完的这条今天不再出现，下一张顶上来
    this.revealed = false;
    this.render();
    toast(remembered ? '记得，下次隔 ' + rec.interval + ' 天再问' : '忘了，间隔回到 1 天，明天再来', 'good');
  },

  skip() {
    if (!this.queue.length) return;
    this.pos++;
    this.revealed = false;
    this.render();
  },

  reveal() {
    this.revealed = true;
    this.render();
    const ans = $('wbReviewAnswer');
    if (ans) ans.focus();
  },

  /* ---------- 渲染 ---------- */

  render() {
    const empty = $('wbReviewEmpty');
    const card = $('wbReviewCard');
    const stats = $('wbReviewStats');
    if (!card) return;

    // 时钟读数放在最前面更新：即使队列为空、卡片没渲染，也要看得出时钟被拨到了第几天
    const clockLabel = $('wbClockLabel');
    if (clockLabel) {
      clockLabel.textContent = clockOffsetMs
        ? '调试时钟 +' + Math.round(clockOffsetMs / DAY_MS) + ' 天'
        : '调试时钟 未拨快';
    }
    // 练习屏窄屏的「复习 N」按钮数字跟着队列走，两屏共用一份数据
    const cnt = $('pReviewCount');
    if (cnt) cnt.textContent = this.queue.length;

    if (stats) {
      stats.hidden = false;
      $('wbStatDue').textContent = this.queue.length;
      $('wbStatDone').textContent = this.day.done.length;
      $('wbStatStreak').textContent = this.scheduled;
    }

    const total = this.queue.length + this.day.done.length;
    if (!total) {
      card.hidden = true;
      if (empty) {
        empty.style.display = '';
        // 今天刚写完空时队列为 0 是排期的正常结果（下次到期=明天），
        // 但只写「暂无待复习内容」会让人以为没同步：这里把刚排进去的项数与到期日直说。
        const hint = $('wbReviewEmptyHint');
        if (hint) {
          hint.textContent = this.scheduled
            ? '已排进 ' + this.scheduled + ' 项'
              + (this.learnedToday ? '，其中今天新学 ' + this.learnedToday + ' 项' : '')
              + (this.nextDueAt ? '，最近 ' + dueDateLabel(this.nextDueAt) + '到期' : '')
            : '完成学习后，系统会自动安排复习计划';
        }
      }
      return;
    }
    if (empty) empty.style.display = 'none';
    card.hidden = false;

    $('wbReviewProg').textContent = this.day.done.length + ' / ' + total;
    $('wbReviewBar').style.width = Math.round(this.day.done.length / total * 100) + '%';

    const body = $('wbReviewBody');
    const acts = $('wbReviewActions');
    body.innerHTML = '';
    acts.innerHTML = '';

    // 队列见底：要么全部完成，要么这一轮把剩下的都跳过了
    if (this.pos >= this.queue.length) {
      const left = this.queue.length;
      $('wbReviewDue').textContent = left ? '这一轮过完了' : '今日复习完成';
      body.appendChild(reviewText('p', 'wb-review-done',
        left ? '跳过的 ' + left + ' 项还留在今天，可以再来一轮。' : '今天该复习的都复习完了，明天见。'));
      if (left) {
        acts.appendChild(reviewBtn('wbReviewAgain', 'btn ghost sm', '再看一遍跳过的', () => { this.pos = 0; this.revealed = false; this.render(); }));
      }
      return;
    }
    if (!this.queue.length) {
      $('wbReviewDue').textContent = '今日复习完成';
      body.appendChild(reviewText('p', 'wb-review-done', '今天该复习的都复习完了，明天见。'));
      return;
    }

    const rec = this.queue[this.pos];
    const cp = this.index.get(rec.checkpointId);
    $('wbReviewDue').textContent = '今日待复习 ' + this.queue.length + ' 项';

    body.appendChild(reviewText('div', 'wb-review-meta',
      '第 ' + (this.pos + 1) + ' / ' + this.queue.length + ' 张 · 当前间隔 ' + (rec.interval | 0) + ' 天 · 错过 ' + (rec.wrongCount | 0) + ' 次'));

    body.appendChild(reviewText('p', 'wb-review-q', cp && cp.question ? cp.question : '（这条检查点的原文已经不在教材里了）'));

    if (cp && cp.docTitle) body.appendChild(reviewText('p', 'wb-review-src', '出自《' + cp.docTitle + '》'));

    acts.appendChild(reviewBtn('wbReviewSkip', 'btn ghost sm', '跳过', () => this.skip()));
    if (!this.revealed) {
      acts.appendChild(reviewBtn('wbReviewReveal', 'btn sm', '显示答案', () => this.reveal()));
      return;
    }

    const ansEl = reviewText('p', 'wb-review-a', '答案：' + (cp ? cp.answer : '—'));
    ansEl.id = 'wbReviewAnswer';
    ansEl.tabIndex = -1;            // 静态段落默认不可聚焦，键盘读者展开答案后要能把焦点送过去
    body.appendChild(ansEl);
    acts.innerHTML = '';
    acts.appendChild(reviewBtn('wbReviewForget', 'btn ghost sm', '忘了', () => this.grade(false)));
    acts.appendChild(reviewBtn('wbReviewRemember', 'btn sm', '记得', () => this.grade(true)));
  },

  /* ---------- 临时调试：把「现在」拨快一天（演示前删掉这段与两个按钮） ---------- */

  /**
   * 只加时钟偏移，一条记录都不改：点 N 次就是过了 N 天，能连续累加。
   * 换天由 dayKey() 自动完成，今天已完成的名单跟着翻篇，进度条重算——
   * 上一版把 nextReviewAt 往过去挪又手动清 done，才会出现「推进到第 2 天就卡住」。
   */
  async shiftOneDay() {
    clockOffsetMs += DAY_MS;
    saveClock();
    await this.refresh();
    const days = Math.round(clockOffsetMs / DAY_MS);
    toast('调试时钟 +' + days + ' 天，今日到期 ' + this.queue.length + ' 项', 'warn');
  },

  async resetClock() {
    clockOffsetMs = 0;
    saveClock();
    await this.refresh();
    toast('调试时钟已归零，回到真实今天', 'warn');
  }
};
