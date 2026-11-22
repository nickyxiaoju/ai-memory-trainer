/* ---------- A. 小工具 & 状态 -------------------------------------------- */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** 轻提示 */
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toast').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
  setTimeout(() => el.remove(), 2900);
}

/** Loading 遮罩 */
function showVeil(title, msg) {
  $('veilTitle').textContent = title || '正在处理…';
  $('veilMsg').textContent = msg || 'AI 正在思考，请稍候。';
  $('veil').classList.add('on');
}
function setVeil(msg) { $('veilMsg').textContent = msg; }
function hideVeil() { $('veil').classList.remove('on'); }

/**
 * 模态浮层里的 Tab 圈闭：走到最后一个可聚焦控件再 Tab 就回到第一个，Shift+Tab 反向。
 * 只过滤掉 display:none 的（offsetParent 为 null），隐藏按钮不该被 Tab 到。
 */
function trapTab(e, box) {
  const f = $$('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', box)
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** 毫秒 -> mm:ss */
function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** 全局状态 */
const S = {
  account: {                 // 账号态：只有 auth.js / app.js 会写，练习流程不得覆盖
    signedIn: false,
    userId: null,
    email: '',
    nickname: '',
    avatarKey: 'leaf-01'
  },
  segments: [],        // [{ text, chars, keywords, blanks:[{start,end,expected,state,attempts,firstTry,hinted}], hintsUsed }]
  idx: 0,
  startedAt: 0,
  errTotal: 0,         // 各空「离开时仍写错」的次数合计
  hintUsed: 0,         // 本次练习按提示的总次数（每段另有 HINT_BUDGET 限额）
  quizDone: false,
  quizResult: null,    // 'ok' | 'skipped' | null
  checkpointAt: 0,     // 50% 触发点（段落下标）
  inPractice: false,   // 是否正处在默写中：顶栏「开始学习」据此决定回准备页还是回默写页
  timerId: null,
  kwCache: new Map(),  // 段落文本 -> 关键词数组，避免重复调用 Groq
  allKeywords: [],
  demoMode: false
};

/* 示例文本（《岳阳楼记》为公版古籍） */
const SAMPLES = {
  yyl: `庆历四年春，滕子京谪守巴陵郡。越明年，政通人和，百废具兴，乃重修岳阳楼，增其旧制，刻唐贤今人诗赋于其上，属予作文以记之。
予观夫巴陵胜状，在洞庭一湖。衔远山，吞长江，浩浩汤汤，横无际涯，朝晖夕阴，气象万千，此则岳阳楼之大观也。
嗟夫！予尝求古仁人之心，或异二者之为，何哉？不以物喜，不以己悲，居庙堂之高则忧其民，处江湖之远则忧其君。是进亦忧，退亦忧。然则何时而乐耶？其必曰“先天下之忧而忧，后天下之乐而乐”乎！`,
  en: `The little library opened in 1998 in a small village, and it had only thirty books at first.
Ten years later, the volunteers brought five hundred new books and a computer room for the children.
Every Saturday morning the students read aloud together, and they write one short sentence about what they learned.
If you visit the library today, you will find a warm wall covered with drawings, and the head librarian still remembers the name of every child.`,
  old: `今天早上我先刷牙，然后吃了两个鸡蛋和一碗小米粥。
我的女儿叫李晓红，她在市第一人民医院当护士，周末会回来看我。
我家住在幸福小区七栋三单元，楼下有一个菜市场，走路大约十分钟。
记东西的时候可以先深呼吸三次，再慢慢地把一句话读两遍，这样更容易记住。`
};

/* ---------- A2. 后端配置与降级态 ---------------------------------------- */
/**
 * 读取 window.APP_CONFIG（由本机不入库的 js/config.js 提供），
 * 判断 Supabase 账号服务是否可用。不可用时不抛错、不阻塞、不重试，
 * 只把 Auth.enabled / Cloud.enabled 关掉，全站退回「本地模式」：
 * 挖空、出题、比对、报告这些核心算法与 Supabase 完全无关，演示永不被阻断。
 */
const AppConfig = {
  ready: false,
  enabled: false,
  url: '',
  anonKey: '',
  phoneOtp: false,
  reason: '',
  reach: 'unknown',      // unknown | off | ok | down（只做一次旁路探测，不影响任何功能）
  reachMsg: '',
  tables: 'unknown',     // unknown | ok | missing（三张表里 profiles 是否已建）

  load() {
    const raw = window.APP_CONFIG || {};
    this.url = String(raw.supabaseUrl || '').trim().replace(/\/+$/, '');
    this.anonKey = String(raw.supabaseAnonKey || '').trim();
    this.phoneOtp = raw.phoneOtp === true;
    this.ready = true;

    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      this.reason = '账号服务脚本未能加载';
    } else if (!this.url) {
      this.reason = '尚未配置 Supabase 项目地址';
    } else if (!this.anonKey) {
      this.reason = '尚未配置 Supabase anon key';
    } else if (!/^https:\/\/[a-z0-9.-]+$/i.test(this.url)) {
      this.reason = '项目地址格式不正确，应为 https://xxxx.supabase.co';
    } else {
      this.enabled = true;
      this.reason = '';
    }
    return this.enabled;
  },

  /**
   * 旁路探测「这个地址现在通不通」，只用来把顶栏文案说准确。
   * 填错项目 ref 时 DNS 直接解析不到，这时显示「本地模式」是误导 ——
   * 配置写了，坏的是连接。结果不改 enabled、不拦任何请求：
   * 网络随时可能恢复，用户仍然可以试着登录，失败自会有中文报错。
   */
  async check() {
    if (!this.enabled) { this.reach = 'off'; return false; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      // 新版 Supabase 项目对所有端点都要求带 apikey，健康检查也不例外（实测不带会 401）
      const r = await fetch(this.url + '/auth/v1/health', {
        headers: { apikey: this.anonKey }, signal: ctl.signal, cache: 'no-store'
      });
      this.reach = r.ok ? 'ok' : 'down';
      this.reachMsg = r.ok ? '' : '账号服务返回 HTTP ' + r.status;
      // 建表了没有，登录之前就能知道。这条探测只读、不写。
      if (this.reach === 'ok') {
        const t = await fetch(this.url + '/rest/v1/profiles?select=id&limit=1', {
          headers: { apikey: this.anonKey, Accept: 'application/json' },
          signal: ctl.signal, cache: 'no-store'
        });
        const body = await t.text().catch(() => '');
        // 200 = 表在（RLS 让匿名读到空数组）；404/PGRST205 = 表真没建；
        // 401/42501 = 表在、只是没给 anon 授权，这正是「未登录读不到任何行」的设计状态，
        // 不能误报成未建表，否则会把登录拦在错误的提示上。
        this.tables = t.status === 200 ? 'ok'
          : t.status === 404 ? 'missing'
          : (t.status === 401 && body.indexOf('42501') > -1) ? 'ok' : 'unknown';
      }
    } catch (e) {
      this.reach = 'down';
      this.reachMsg = (e && e.name === 'AbortError') ? '请求超时' : '域名解析不到或网络不通';
    } finally {
      clearTimeout(timer);
    }
    return this.reach === 'ok';
  }
};

/* ---------- B. 屏幕导航 / 配置持久化 ------------------------------------ */
const SCREENS = ['screen-home', 'screen-setup', 'screen-practice', 'screen-report', 'screen-auth', 'screen-profile'];
function go(name) {
  SCREENS.forEach(s => {
    const el = $(s);
    if (el) el.classList.toggle('on', s === 'screen-' + name);
  });
  const stepMap = { home: 1, setup: 2, practice: 3, report: 3, auth: 0, profile: 0 };
  $$('.stepdot').forEach(d => {
    const n = Number(d.dataset.step);
    d.classList.toggle('on', n <= (stepMap[name] || 0));
  });
  $$('.navtab').forEach(b => {
    const group = ({ setup: 'setup', practice: 'setup', report: 'setup', profile: 'profile' })[name] || '';
    b.classList.toggle('on', b.dataset.goto === group);
  });
  document.documentElement.classList.toggle('snap-home', name === 'home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
