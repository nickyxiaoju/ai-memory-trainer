/* ---------- E. 智能挖空与区间构造 -------------------------------------- */

/**
 * 关键词是否还有可判定的内容：去掉标点和空白之后必须剩字母/数字/汉字。
 * 纯标点或纯空白的关键词会让 judgeFill 两边都取到空串，于是那个空永远写不对，
 * 段落再也推不下去——这是与 NBSP 同一类的死锁，必须在进入挖空之前就地丢掉。
 */
function judgeableKeyword(s) {
  return Array.from(String(s == null ? '' : s)).some(c => /[\p{L}\p{N}]/u.test(c));
}

/* 关键词在段落中的位置区间：行内挖空与逐空明细都由它派生，所以只保留这一套匹配规则。 */
function keywordRanges(text, keywords) {
  const chars = Array.from(String(text));
  const seen = new Map();                       // "start,end" -> 区间，去掉重叠重复
  (keywords || []).forEach(raw => {
    // 段落的空白已经归一过，关键词必须走同一套规则，否则模型返回一个带 NBSP 的短语就悄悄挖不出空
    const kw = normText(raw);
    const k = Array.from(kw);
    if (!k.length || !judgeableKeyword(kw)) return;
    for (let i = 0; i + k.length <= chars.length; i++) {
      let hit = true;
      for (let j = 0; j < k.length; j++) if (chars[i + j] !== k[j]) { hit = false; break; }
      if (!hit) continue;
      const key = i + ',' + (i + k.length);
      if (!seen.has(key)) seen.set(key, { start: i, end: i + k.length, keyword: kw, expected: chars.slice(i, i + k.length).join('') });
    }
  });
  return [...seen.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * 行内挖空的空位表：把关键词区间整理成一串互不重叠的空。
 * - 重叠或首尾相接的区间合并成一个空（否则两个空挤在同一处文字上，用户填谁都不对）
 * - 「long time no see」这类含空格的英文短语整体算一个空，不再按词拆开
 * - 每个空自带状态机，判定只看它自己，没有任何全局长度条件，结构上就不可能死锁
 */
function buildBlanks(text, keywords, segIdx) {
  return rangesToBlanks(mergeRanges(keywordRanges(text, keywords)), text, segIdx);
}

/* 区间合并：重叠或首尾相接的区间并成一个，否则两个空会挤在同一处文字上，用户填谁都不对 */
function mergeRanges(ranges) {
  const out = [];
  (ranges || []).forEach(r => {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
      if (Array.from(r.keyword).length > Array.from(last.keyword).length) last.keyword = r.keyword;
      return;
    }
    out.push({ start: r.start, end: r.end, keyword: r.keyword });
  });
  return out;
}

function rangesToBlanks(ranges, text, segIdx) {
  const chars = Array.from(String(text));
  return (ranges || []).map((r, i) => ({
    id: 'b' + segIdx + '-' + i,
    segIdx: segIdx,
    idx: i,
    start: r.start,
    end: r.end,
    keyword: r.keyword,
    expected: chars.slice(r.start, r.end).join(''),
    state: 'empty',                 // empty 待填写 | ok 已写对 | bad 还需修改
    attempts: 0,                    // 用户「写完离开」这个空的次数（逐字输入的中间态不计）
    firstTry: null,                 // null=没判定过 | true=第一次离开就已写对 | false=先错过
    typed: null,                    // 最后一次原始输入，落进 blanks.final_text 供复盘
    hinted: false,
    hintChars: 0,
    el: null,
    hintEl: null
  }));
}

/**
 * 关掉「AI 智能挖空」时的空位来源：整段按标点切块，标点留在块外照常显示，块内每个字都要默写出来。
 * 这是旧版「不挖空也得把整段打一遍」的等价替代——判定只看字母/数字/汉字，
 * 不逼用户敲标点，块与块各自判定，仍然没有任何全局长度条件。
 */
function clauseRanges(text, maxLen) {
  const chars = Array.from(String(text));
  const cap = maxLen || 16;
  const out = [];
  let s = 0;
  const push = (a, b) => {
    while (a < b && /\s/.test(chars[a])) a++;            // 块首空格不算内容，否则空位里挂着一个看不见的空格
    while (b - a > cap) { out.push({ start: a, end: a + cap, keyword: chars.slice(a, a + cap).join('') }); a += cap; }
    if (b - a >= 1 && judgeableKeyword(chars.slice(a, b).join(''))) out.push({ start: a, end: b, keyword: chars.slice(a, b).join('') });
  };
  for (let i = 0; i < chars.length; i++) {
    if ('。！？!?；;，,、：:…—'.indexOf(chars[i]) < 0) continue;
    let e = i;
    while (e > s && chars[e - 1] === ' ') e--;      // 块尾空格不算内容
    push(s, e);
    s = i + 1;
  }
  let tail = chars.length;
  while (tail > s && chars[tail - 1] === ' ') tail--;
  push(s, tail);
  return out;
}

/* 本地兜底关键词用的词表：地名/机构名后缀、需从候选词头部剔除的虚词、中英文停用词 */
const PLACE_SUFFIX = list('楼湖江河山水市省县区镇乡村寺塔桥郡州城站路街院园口洞场店厂校社');
const TRIM_LEAD = list('的了在是叫住和与及把被对向从于同到来去有守谪为将其此之而则即个一观夫');
const STOP_WORDS = new Set(('然后 所以 因为 我们 他们 她们 你们 可以 这个 那个 一个 今天 明天 早上 晚上 已经 不是 就是 如果 这样 那样 什么 怎么 这里 那里 我的 你的 他的 她的 大约 十分钟 非常 一起 时候 需要 护士 老师 医生 朋友 家人 the a an and or but if of to in on at is are was were for with that this these those they them we you it its his her their our your my as by from will would can could should may might have has had do does did not every when where what how why who little such then than')
  .split(/\s+/).map(w => w.toLowerCase()));

function list(s) { return new Set(Array.from(s.replace(/\s+/g, ''))); }
function isStopWord(w) { return STOP_WORDS.has(String(w).trim().toLowerCase()); }

/**
 * 本地兜底：无 Groq / 接口失败时，从段落里挑 1–2 个“最值得考”的片段。
 * 规则优先级：关键数据（数字/年份） → 地名与机构名后缀 → 引导词后的专名 → 英文专名/长词 → 最长汉字块。
 */
function localKeywords(text) {
  const chars = Array.from(text);
  const found = [];
  const add = (w) => {
    w = String(w == null ? '' : w).trim();
    const n = Array.from(w).length;
    if (n < 2 || n > 8) return;
    if (!text.includes(w) || isStopWord(w)) return;
    if (!found.includes(w)) found.push(w);
  };

  // 1) 阿拉伯数字（年份、比例等关键数据）
  (text.match(/\d+(?:[.,]\d+)?%?/g) || []).forEach(add);

  // 2) 时间与量级数据（“庆历四年”“1998 年”“七十万”）；“个/次”这类纯量词考核价值低，不挖
  let m;
  const reCnNum = /(\d+|[一二三四五六七八九十百千零]+)(年|月|日|万|亿)/g;
  while ((m = reCnNum.exec(text))) {
    const back = m[2] === '年' ? 2 : 0;   // 年份向前多带两字，可还原“庆历四年”这类年号
    add(text.slice(Math.max(0, m.index - back), m.index + m[0].length));
  }

  // 3) 连续的汉字块，供地名/兜底规则使用
  const blocks = [];
  let run = -1;
  chars.forEach((c, i) => {
    const cjk = /[㐀-鿿]/.test(c);
    if (cjk && run < 0) run = i;
    if (run >= 0 && (!cjk || i === chars.length - 1)) { blocks.push([run, cjk ? i + 1 : i]); run = -1; }
  });
  // 以地名/机构名后缀结尾的短语：后缀向前最多带 3 字，并剔除开头的虚词
  blocks.forEach(([b, e]) => {
    const seg = chars.slice(b, e);
    for (let i = seg.length - 1; i >= 0; i--) {
      if (!PLACE_SUFFIX.has(seg[i])) continue;
      let s = Math.max(0, i - 3);
      while (i + 1 - s > 2 && TRIM_LEAD.has(seg[s])) s++;   // 逐个剔除开头的虚词，避免把整句都挖空
      add(seg.slice(s, i + 1).join(''));
      break;
    }
  });

  // 4) “叫/住在/来自/位于”之后的专名
  const reName = /(?:叫|住在|来自|位于|叫做)([㐀-鿿]{2,5})/g;
  while ((m = reName.exec(text))) add(m[1]);

  // 5) 英文：首字母大写专名优先，其次较长的普通词
  (text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).slice(0, 2).forEach(add);
  if (!found.length) (text.match(/\b[a-zA-Z]{6,}\b/g) || []).slice(0, 2).forEach(add);

  // 6) 仍无命中：取汉字块结尾的 2–3 字（中文的宾语通常落在短语末尾，如“先刷牙”→“刷牙”）
  if (!found.length) {
    const WEAK = new Set([...TRIM_LEAD, ...list('先后再又两每各很最多老少')]);
    blocks.slice().sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).forEach(([b, e]) => {
      let s = Math.max(b, e - 3);
      while (e - s > 2 && WEAK.has(chars[s])) s++;
      add(chars.slice(s, e).join(''));
    });
  }
  return found.slice(0, 2);
}

/**
 * 功能 A：调用 Groq 提取该段 1–2 个核心关键词（人名/地名/关键数据）。
 * 失败或未配置时退回本地启发式算法，保证演示不中断。
 */
async function aiKeywords(text) {
  if (S.kwCache.has(text)) return S.kwCache.get(text);
  let kws = null;
  if (!S.demoMode && $('groqKey').value.trim()) {
    try {
      $('aiState').textContent = 'AI 正在挑选关键词…';
      const j = await groqJSON(
        '你是教育记忆训练助手，擅长从文本中挑出最值得被“挖空”考核的关键信息。',
        '下面是一段供学生或老人默写背诵的文本。请挑出 1 到 2 个最核心的关键词（优先：人名、地名、年份或数字等关键数据、最能体现主旨的词组）。\n' +
        '硬性要求：每个关键词必须是原文中逐字出现的连续片段，长度 2–8 个字（英文为 1–2 个词），不要加标点。\n' +
        '输出 JSON 格式：{"keywords":["词1","词2"]}\n\n原文：' + text
      );
      if (j && Array.isArray(j.keywords)) {
        // 只保留确实出现在原文中的词，防止模型改写
        kws = j.keywords.map(k => String(k).trim()).filter(k => k && text.includes(k)).slice(0, 2);
        if (!kws.length) kws = null;
      }
    } catch (e) {
      toast('AI 挖空失败，已改用本地算法：' + friendlyErr(e), 'warn');
      kws = null;
    }
  }
  if (!kws) kws = localKeywords(text);
  S.kwCache.set(text, kws);
  $('aiState').textContent = (S.demoMode || !$('groqKey').value.trim()) ? '挖空来源：本地算法' : '挖空来源：Groq AI';
  return kws;
}
