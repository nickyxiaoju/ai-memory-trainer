/* ---------- B2. 本机存储层 ---------------------------------------------- */
/**
 * 浏览器 localStorage 的唯一出入口。
 *
 * 分桶原则（评审会追问，必须站得住）：
 *   prefs    —— 练习偏好，非机密，登录后可以再从云端 profiles.prefs 覆盖。
 *   secrets  —— Hugging Face Token / Groq API Key，只有勾选「记住密钥」才写入，
 *               任何情况下都不进数据表、不进代码仓库、不进日志。
 *   history  —— 本机练习记录（未登录时是唯一的一份）。
 *   book     —— 本机练习册（练过的原文，只在本机，绝不同步到云端）。
 *   桶名带账号后缀（::uid / ::anon），换账号不会看到别人的数据；
 *   Supabase 自己的会话 token 单独存在 memtrainer-auth::... 前缀下，由 SDK 管理。
 */
const Store = {
  uid: null,
  BASE_PREFS: 'memtrainer_cfg',
  BASE_SECRETS: 'memtrainer_secrets',
  BASE_HISTORY: 'memtrainer_history',
  BASE_BOOK: 'memtrainer_book',
  BASE_PROMPT: 'memtrainer_sync_prompt',   // 「同步提示已处理过」，避免每次登录重复弹窗
  HISTORY_LIMIT: 200,
  BOOK_LIMIT: 60,

  key(base) { return base + '::' + (this.uid || 'anon'); },
  keyFor(base, uid) { return base + '::' + (uid || 'anon'); },

  /** 切换账号命名空间；uid 为 null 表示未登录 */
  setAccount(uid) { this.uid = uid || null; },

  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },

  prefs() { return this.read(this.key(this.BASE_PREFS), {}); },
  savePrefs(patch) {
    const next = Object.assign({}, this.prefs(), patch);
    if (!this.write(this.key(this.BASE_PREFS), next)) toast('无法写入本机存储（浏览器限制）', 'warn');
  },
  secrets() { return this.read(this.key(this.BASE_SECRETS), {}); },

  /** 只清除密钥，不动练习偏好与历史记录 */
  clearSecrets() {
    this.remove(this.key(this.BASE_SECRETS));
    if ($('hfToken')) $('hfToken').value = '';
    if ($('groqKey')) $('groqKey').value = '';
    if ($('rememberKeys')) $('rememberKeys').checked = false;
  },

  /** 练习偏好（供云端 profiles.prefs 同步使用，绝不含密钥） */
  PREF_KEYS: ['chunk', 'groqModel', 'ocrModel', 'optCloze', 'optQuiz', 'optBig', 'optSpeak', 'demoMode', 'fontStyle'],
  collectPrefs() {
    const out = {};
    this.PREF_KEYS.forEach(k => {
      const el = $(k);
      if (!el) return;
      out[k] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    return out;
  },
  applyPrefs(p) {
    if (!p || typeof p !== 'object') return;
    this.PREF_KEYS.forEach(k => {
      if (!(k in p)) return;
      const el = $(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!p[k]; else el.value = p[k];
    });
    S.demoMode = !!$('demoMode').checked;
    const big = $('optBig').checked;
    document.documentElement.style.setProperty('--fs', big ? '22px' : '18px');
    document.documentElement.classList.toggle('t-big', big);
  },

  /* ---------- 历史 ---------- */
  history() {
    const h = this.read(this.key(this.BASE_HISTORY), []);
    return Array.isArray(h) ? h : [];
  },
  saveHistory(list) {
    const trimmed = list.slice(0, this.HISTORY_LIMIT);
    const ok = this.write(this.key(this.BASE_HISTORY), trimmed);
    if (!ok) toast('本机存储写入失败，历史记录没能保存', 'warn');
    return ok;
  },
  unsynced() { return this.history().filter(r => !r.synced); },

  /* ---------- 练习册 ---------- */
  /**
   * 本机练习册只收「开始练习」那一刻的 srcText，供下次直接复用。
   * 刻意不同步到云端：全站的隐私承诺是云端只有统计与关键词明细、没有原文，
   * 练习册若上传就等于破了这条线，所以它和密钥一样只住在本机。
   */
  book() {
    const b = this.read(this.key(this.BASE_BOOK), []);
    return Array.isArray(b) ? b : [];
  },
  saveBook(list) {
    const trimmed = list.slice(0, this.BOOK_LIMIT);
    if (!this.write(this.key(this.BASE_BOOK), trimmed)) toast('本机存储写入失败，练习册没能保存', 'warn');
  },
  /** 相同正文只保留一条并顶到最前；显式 title 优先，其次沿用已有标题，再退回首行前 24 字。
      沿用已有标题是必须的：startPractice 自动收录时没有标题，若每次都拿首行覆盖，
      用户用「加入练习册」起的标题会在第一次练习后被正文首行顶掉。 */
  addToBook(text, title) {
    const t = (text || '').trim();
    if (!t) return;
    const list = this.book();
    const i = list.findIndex(e => e && e.text === t);
    const given = String(title || '').trim();
    const entry = {
      id: (i > -1 && list[i].id) || ('b' + Date.now() + Math.random().toString(36).slice(2, 6)),
      title: given || (i > -1 && list[i].title) || t.split(/\n/)[0].slice(0, 24),
      text: t,
      at: Date.now()
    };
    if (i > -1) list.splice(i, 1);
    list.unshift(entry);
    this.saveBook(list);
  },

  /**
   * 把「未登录期间」记在本机的练习并入当前账号，
   * 这样个人中心一进去就能看到之前练过的内容，而不是空白。
   * 每次登录都跑：登出后再练的记录不能被丢掉。
   * 幂等靠记录 id 去重，并入后删掉 anon 桶，因此重复登录不会重复计数。
   */
  mergeAnonIntoSelf() {
    if (!this.uid) return 0;
    const anonKey = this.keyFor(this.BASE_HISTORY, null);
    const anon = this.read(anonKey, []);
    if (!Array.isArray(anon) || !anon.length) return 0;
    const mine = this.history();
    const have = new Set(mine.map(r => r.id));
    let moved = 0;
    anon.forEach(r => {
      if (r && r.id && !have.has(r.id)) { mine.push(Object.assign({}, r, { synced: false })); moved++; }
    });
    // 写入失败时保留 anon 桶，否则这些记录会既没进当前账号、也被删掉
    if (moved && !this.saveHistory(mine)) return 0;
    this.remove(anonKey);
    return moved;
  }
};

/* ---------- 配置表单读写（沿用原有函数名，调用点不变） ------------------ */

/** 旧单文件版本把密钥和偏好混在同一个无账号后缀的键里，这里做一次搬家 */
const LEGACY_CFG = 'memtrainer_cfg';
function migrateLegacyCfg() {
  const legacy = Store.read(LEGACY_CFG, null);
  if (!legacy || typeof legacy !== 'object') return;
  const patch = {};
  Store.PREF_KEYS.forEach(k => { if (k in legacy) patch[k] = legacy[k]; });
  if (legacy.srcText) patch.srcText = legacy.srcText;
  Store.savePrefs(patch);
  if (legacy.remember && (legacy.hfToken || legacy.groqKey)) {
    Store.write(Store.key(Store.BASE_SECRETS), { hfToken: legacy.hfToken || '', groqKey: legacy.groqKey || '' });
  }
  Store.remove(LEGACY_CFG);
}

/** 把本机存好的偏好与（勾选了记住时的）密钥回填到表单 */
function loadCfg() {
  migrateLegacyCfg();
  const p = Store.prefs();
  const s = Store.secrets();
  try {
    if (s.hfToken) $('hfToken').value = s.hfToken;
    if (s.groqKey) $('groqKey').value = s.groqKey;
    if (s.hfToken || s.groqKey) $('rememberKeys').checked = true;
    if (p.srcText) $('srcText').value = p.srcText;
    Store.applyPrefs(p);
  } catch (e) { /* 本机存储不可用不影响任何功能 */ }
  refreshKeyState();
}

/** 表单变化时写回本机：偏好总是写，密钥只在勾选「记住密钥」时写 */
function saveCfg() {
  const remember = $('rememberKeys').checked;
  const patch = Store.collectPrefs();
  patch.srcText = $('srcText').value;
  Store.savePrefs(patch);
  if (remember) {
    Store.write(Store.key(Store.BASE_SECRETS), {
      hfToken: $('hfToken').value.trim(),
      groqKey: $('groqKey').value.trim()
    });
  } else {
    Store.remove(Store.key(Store.BASE_SECRETS));
  }
}

function refreshKeyState() {
  const hf = !!$('hfToken').value.trim(), gq = !!(S.demoMode ? false : $('groqKey').value.trim());
  const parts = [];
  parts.push(hf ? 'OCR 可用' : 'OCR 未配置');
  parts.push(S.demoMode ? 'AI 功能：演示模式（本地算法）' : (gq ? 'AI 功能：Groq 已连接' : 'AI 功能：未配置（将用本地兜底算法）'));
  $('keyState').textContent = '状态：' + parts.join(' · ');
}
