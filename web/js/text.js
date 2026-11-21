/* ---------- D. 分段引擎 ------------------------------------------------ */
const CHUNK_TARGET = { short: [18, 40], mid: [40, 80], long: [80, 140] };

/**
 * 统一空白：换行/制表/全角空格/NBSP -> 单个空格，零宽字符直接丢掉。
 * 这一步是「76/76 却过不去」那类死锁的源头堵漏：抄来的课文常带 U+00A0（网页里复制的
 * 空格）与 U+200B（零宽空格），过去只有 ASCII 空格被归一，目标串里留着 NBSP，
 * 而用户敲的是真空格，两者永远不相等，段就永远推不下去。
 * 段落仍按 \n 切开，所以切出来的任何一段内部都不会再有换行。
 */
function normText(t) {
  return String(t)
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '')      // 零宽字符与软连字符：不是文字，直接删
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u3000\u00A0\u2007\u202F]+/g, ' ')       // 各类空格统一成一个
    .replace(/\n+/g, '\n')
    .trim();
}

/** 把长文本切成适合默写的段落 */
function splitSegments(raw) {
  const t = normText(raw);
  if (!t) return [];
  // 1) 先切成句子
  const paras = t.split('\n').map(s => s.trim()).filter(Boolean);
  const sentences = [];
  paras.forEach(p => {
    let buf = '';
    for (const ch of p) {
      buf += ch;
      if ('。！？!?；;'.includes(ch)) { sentences.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) sentences.push(buf.trim());
  });
  // 2) 按目标长度贪心累积
  const [min, max] = CHUNK_TARGET[$('chunk').value] || CHUNK_TARGET.mid;
  const out = [];
  let cur = '';
  sentences.forEach(s => {
    // 超长单句：先按逗号累积，仍超长则交给 hardSplit
    if (s.length > max * 1.3) {
      if (cur) { out.push(cur); cur = ''; }
      let b = '';
      const pieces = s.split(/(?<=[，,、：:])/).filter(Boolean);
      pieces.forEach(piece => {
        if (piece.length > max) { if (b) { out.push(b.trim()); b = ''; } hardSplit(piece, max).forEach(x => out.push(x)); return; }
        if ((b + piece).length > max && b) { out.push(b.trim()); b = piece; } else { b += piece; }
      });
      if (b.trim()) out.push(b.trim());
      return;
    }
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = s; }
    else { cur = (cur + ' ' + s).trim(); }
  });
  if (cur.trim()) out.push(cur.trim());
  // 3) 过短的片段并入相邻段（合并后不得超过长度上限，避免既丢内容又产生超长段）
  const merged = [];
  out.forEach(s => {
    const prev = merged.length ? merged[merged.length - 1] : null;
    if (prev !== null && s.length < min && (prev.length + s.length + 1) <= max) merged[merged.length - 1] = (prev + ' ' + s).trim();
    else merged.push(s);
  });
  if (merged.length > 1 && merged[0].length < min && (merged[0].length + merged[1].length + 1) <= max) {
    merged[1] = (merged[0] + ' ' + merged[1]).trim();
    merged.shift();
  }
  return merged;
}

/** 兜底切分：一段没有任何标点的超长文本，先按空格、再按长度硬切 */
function hardSplit(s, max) {
  const words = s.split(/(?<= )/).filter(Boolean);
  if (words.length > 1) {
    const out = [];
    let b = '';
    words.forEach(w => { if ((b + w).length > max && b) { out.push(b.trim()); b = w; } else { b += w; } });
    if (b.trim()) out.push(b.trim());
    return out;
  }
  const arr = Array.from(s), res = [];
  for (let i = 0; i < arr.length; i += max) res.push(arr.slice(i, i + max).join(''));
  return res;
}
