/* ---------- M. 应用编排：事件绑定 + 启动 ------------------------------- */

/**
 * App 负责三件事：
 *   1. 顶栏登录态胶囊与两个主入口（开始学习 / 个人中心）。
 *   2. 账号回调之后的收尾：并入本机记录、拉云端资料、决定是否弹同步面板。
 *   3. 练习结束或中途退出时落一份数据：先本机，再尽力上传云端。
 */
const App = {
  formMode: 'signin',      // signin | signup，决定「注册」按钮要不要显示昵称与确认密码
  signInBusy: false,       // 防止 SIGNED_IN 与首屏恢复同时跑一遍收尾

  /* ---------- 顶栏 ---------- */
  renderChip() {
    const chip = $('authChip');
    if (!chip) return;
    chip.classList.remove('on', 'local');
    if (!AppConfig.enabled) {
      chip.innerHTML = '<span class="dot"></span>本地模式';
      chip.classList.add('local');
      chip.title = AppConfig.reason + '：练习与算法仍可完整使用，记录只存在这台浏览器';
    } else if (S.account.signedIn) {
      chip.innerHTML = '<span class="dot"></span>' + escapeHtml(S.account.nickname || S.account.email || '已登录');
      chip.classList.add('on');
      chip.title = '已进入个人中心，可查看练习记录与资料';
    } else if (AppConfig.reach === 'down') {
      // 配置是写全的，坏的是连接：如实说「连不上」，不要冒充「本地模式」
      chip.innerHTML = '<span class="dot"></span>未连接';
      chip.classList.add('local');
      chip.title = '已填写项目地址但连不上（' + (AppConfig.reachMsg || '未知原因') +
        '）。请检查本机网络或 js/config.js 里的 supabaseUrl；练习与记录仍然保存在本机。';
    } else {
      chip.innerHTML = '<span class="dot"></span>未登录';
      chip.title = '登录后练习记录会同步到你自己的账号；不登录也能练习';
    }
  },

  goPractice() {
    // 正在默写时回到默写，其余情况回到准备页：两个入口对应阶段划分
    go(S.inPractice ? 'practice' : 'setup');
  },

  /* ---------- 账号回调 ---------- */
  async onAuthState(event, session) {
    if (event === 'SIGNED_OUT') {
      Auth.session = null;
      Auth.apply(null);
      // 退出后切回匿名命名空间：先清空输入框，再按匿名桶回填；
      // 保留匿名桶里「登录前记住的密钥」，但绝不会把上一个账号的密钥留在界面上
      $('hfToken').value = '';
      $('groqKey').value = '';
      $('rememberKeys').checked = false;
      $('srcText').value = '';
      loadCfg();
      updateSplitInfo();
      App.renderChip();
      // 只复位账号态：正在默写的段落、计时、进度全部保留，不打断练习
      if ($('screen-profile').classList.contains('on') || $('screen-auth').classList.contains('on')) go('workbench');
      return;
    }
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { App.renderChip(); return; }
    // 首屏恢复的收尾工作统一交给 boot()，避免同一份资料被读两遍
    if (event === 'INITIAL_SESSION') { if (session) Auth.apply(session); App.renderChip(); return; }
    if (event === 'SIGNED_IN') {
      // SDK 只在事件里把会话递过来，账号态必须自己落盘：不调 apply 的话
      // afterSignIn 第一行就会因为 signedIn=false 直接 return，
      // 表现是「登录明明成功了，却什么都没发生」——顶栏仍是未登录。
      Auth.apply(session);
      App.renderChip();
      await App.afterSignIn(true);
    }
  },

  /** 登录成功后的收尾：并入本机记录 -> 读资料 -> 决定要不要弹同步面板 */
  async afterSignIn(interactive) {
    if (!S.account.signedIn || !Cloud.ready()) return;
    if (this.signInBusy) return;
    this.signInBusy = true;
    try {
      Store.mergeAnonIntoSelf();
      // 账号命名空间刚切换：把该账号保存的偏好与密钥回填到表单，
      // 否则会拿匿名桶的值去覆盖云端偏好（重载后尤其明显）
      loadCfg();
      updateSplitInfo();
      const p = await Cloud.loadProfile();
      if (p.ok) {
        const localPrefs = Store.prefs();
        if (!Object.keys(localPrefs).length && p.data.prefs && Object.keys(p.data.prefs).length) {
          Store.applyPrefs(p.data.prefs);   // 这台设备第一次登录：沿用云端的练习偏好
        } else {
          Cloud.syncPrefs();                // 本机已有偏好：以本机为准回写云端
        }
      } else if (p.error) {
        toast('资料读取失败：' + p.error, 'warn');
      }
      App.renderChip();
      if (interactive && $('screen-auth').classList.contains('on')) go('profile');
      await Profile.refresh();
      if (History.pending().length && !Store.read(Store.key(Store.BASE_PROMPT), false)) {
        Profile.openSheet();
      }
    } finally {
      this.signInBusy = false;
    }
  },

  /* ---------- 练习结果落库：先本机（同步），再尽力上云（后台） ---------- */
  persist(completed) {
    let rec = null;
    try {
      rec = History.build(completed);
      History.record(rec);
    } catch (e) {
      toast('本机记录保存失败：' + (e && e.message ? e.message : e), 'warn');
      return null;
    }
    if (Cloud.ready()) {
      // 报告页不能因为网络慢而卡住：云端写入放在后台，回来再提示结果
      Cloud.saveSession(rec).then(r => {
        if (r.ok) toast('本次记录已同步到你的账号');
        else toast('记录已存在本机，云端同步失败：' + r.error, 'warn');
        if ($('screen-profile').classList.contains('on')) Profile.refresh();
        Profile.renderSyncInfo();
      });
    }
    return rec;
  },

  /* ---------- 登录表单 ---------- */
  setFormMode(mode) {
    this.formMode = mode;
    const signup = mode === 'signup';
    $('nickRow').hidden = !signup;
    $('pwd2Row').hidden = !signup;
    $('btnSignin').textContent = signup ? '切换到登录' : '登录';
    $('btnSignup').textContent = signup ? '确认注册' : '注册新账号';
    $('authPwd').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    $('authPwd').focus();
  },

  authError(msg) {
    const el = $('authErr');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'tip warn';
    el.textContent = msg;
  },

  emailInput() { return $('authEmail').value.trim().toLowerCase(); },
  pwdInput() { return $('authPwd').value; },

  async doSignin() {
    this.authError('');
    if (!AppConfig.enabled) return this.authError('当前是本地模式：' + AppConfig.reason + '。填好 js/config.js 后即可登录。');
    // 探测确认「表不存在」时才拦：这时登录能成功，但个人中心读不到任何东西，
    // 与其让人空登录，不如一句话说明白。'unknown'（探测还没回来/网络异常）不拦。
    if (AppConfig.tables === 'missing') return this.authError('数据表还没有创建：请先在 Supabase 控制台的 SQL Editor 执行 sql/001_init.sql，再登录。');
    const email = this.emailInput(), pwd = this.pwdInput();
    if (!Auth.validEmail(email)) return this.authError('请填写正确的邮箱地址');
    if (!pwd) return this.authError('请填写密码');
    const r = await Auth.signIn(email, pwd);
    if (!r.ok) return this.authError(r.error);
    toast('登录成功');
  },

  async doSignup() {
    this.authError('');
    if (!AppConfig.enabled) return this.authError('当前是本地模式：' + AppConfig.reason + '，暂时无法注册。');
    if (AppConfig.tables === 'missing') return this.authError('数据表还没有创建：现在注册只会留下一个没有资料行的账号。请先在 Supabase 控制台的 SQL Editor 执行 sql/001_init.sql。');
    const email = this.emailInput(), pwd = this.pwdInput(), pwd2 = $('authPwd2').value;
    const nickname = $('authNickname').value.trim().slice(0, 24);
    if (!Auth.validEmail(email)) return this.authError('请填写正确的邮箱地址');
    if (!Auth.validPwd(pwd)) return this.authError('密码至少 8 位');
    if (pwd !== pwd2) return this.authError('两次输入的密码不一致');
    const r = await Auth.signUp(email, pwd, nickname);
    if (!r.ok) return this.authError(r.error);
    if (r.data && r.data.session) {
      toast('注册成功，已自动登录');
      $('authPwd').value = '';
    } else {
      this.authError('账号已创建，但需要先到邮箱点击确认邮件才能登录。' +
        '演示项目通常在 Authentication 里关闭邮箱确认，如果你不希望被邮件卡住，可让管理员关闭该项。');
      toast('确认邮件已发出', 'warn');
    }
  },

  async doForgot() {
    this.authError('');
    const email = this.emailInput();
    if (!AppConfig.enabled) return this.authError('当前是本地模式，无法发送重置邮件。');
    if (!Auth.validEmail(email)) return this.authError('请先在上面的邮箱框填写要重置的邮箱');
    const r = await Auth.resetPassword(email);
    if (!r.ok) return this.authError(r.error);
    this.authError('');
    $('authErr').hidden = false;
    $('authErr').className = 'tip info';
    $('authErr').textContent = '重置请求已发出。请在同一台电脑、同一个浏览器里打开邮件中的链接；' +
      '如果收不到邮件，多半是 Supabase 还没配置自定义 SMTP（内置发信只投递给项目团队成员，且每小时约 2 封），' +
      '此时请让管理员在控制台 Authentication → Users 里手动重置。';
  },

  async doSaveNewPwd() {
    const p1 = $('newPwd').value, p2 = $('newPwd2').value;
    if (!Auth.validPwd(p1)) return toast('新密码至少 8 位', 'warn');
    if (p1 !== p2) return toast('两次输入的新密码不一致', 'warn');
    const r = await Auth.updatePassword(p1);
    if (!r.ok) return toast('修改失败：' + r.error, 'err');
    $('newPwd').value = ''; $('newPwd2').value = '';
    $('recoverCard').hidden = true;
    toast('新密码已生效');
  },

  /* ---------- 手机验证码（默认关闭） ---------- */
  renderAuthMode() {
    const phoneOn = AppConfig.enabled && AppConfig.phoneOtp;
    $('tabPhone').hidden = !phoneOn;
    const note = $('phoneNote');
    if (AppConfig.enabled && !AppConfig.phoneOtp) {
      note.hidden = false;
      note.className = 'muted small';
      note.textContent = '手机验证码登录未启用。它需要先在 Supabase 控制台 Authentication → Sign In / Providers ' +
        '启用 Phone provider，并在 Third-Auth Providers 绑定一家短信服务商；' +
        '验证码的发送与校验都由 Supabase 服务端完成，前端无法在本地验证短信。';
    } else if (phoneOn) {
      note.hidden = true;
    }
    const line = AppConfig.enabled
      ? '账号服务：已配置（' + AppConfig.url.replace(/^https:\/\//, '') + '）' +
        (AppConfig.reach === 'down' ? '，但当前连不上：' + (AppConfig.reachMsg || '未知原因')
          : AppConfig.tables === 'missing' ? '，但数据表还没有建：请先在 SQL Editor 执行 sql/001_init.sql，再注册登录'
          : AppConfig.tables === 'ok' ? '，数据表已就绪' : '')
      : '账号服务：' + (AppConfig.reason || '未配置') + '，当前为本地模式，所有数据只存在这台浏览器';
    $('authMode').textContent = line;
    $('authMode').classList.toggle('warn', AppConfig.enabled && (AppConfig.reach === 'down' || AppConfig.tables === 'missing'));
  },

  setAuthTab(which) {
    const phone = which === 'phone';
    $('tabEmail').classList.toggle('on', !phone);
    $('tabEmail').setAttribute('aria-pressed', String(!phone));
    $('tabPhone').classList.toggle('on', phone);
    $('tabPhone').setAttribute('aria-pressed', String(phone));
    $('paneEmail').hidden = phone;
    $('panePhone').hidden = !phone;
  },

  async doSendOtp() {
    this.authError('');
    const phone = $('authPhone').value.replace(/[\s-]/g, '');
    if (!Auth.validPhone(phone)) return this.authError('手机号要带国家码，例如 +8613800000000');
    const r = await Auth.sendPhoneOtp(phone);
    if (!r.ok) return this.authError(r.error);
    this.authError('');
    $('authErr').hidden = false;
    $('authErr').className = 'tip info';
    $('authErr').textContent = '验证码已交给 Supabase 发送，请以实际收到的短信为准。';
    $('authOtp').focus();
  },

  async doVerifyOtp() {
    this.authError('');
    const phone = $('authPhone').value.replace(/[\s-]/g, '');
    const token = $('authOtp').value.trim();
    if (!Auth.validPhone(phone)) return this.authError('手机号要带国家码，例如 +8613800000000');
    if (!token) return this.authError('请填写收到的短信验证码');
    const r = await Auth.verifyPhoneOtp(phone, token);
    if (!r.ok) return this.authError(r.error);
    toast('手机验证码登录成功');
  },

  async doSignout() {
    const r = await Auth.signOut();
    if (!r.ok) toast('退出失败：' + r.error, 'warn');
    else toast('已退出登录，本机记录仍保留');
  },

  clearLocal() {
    if (!confirm('将清除这台浏览器保存的第三方 API 密钥与全部本机练习记录。\n云端已同步的记录不会被删除。确定继续吗？')) return;
    Store.clearSecrets();
    History.clearAll();
    Store.remove(Store.key(Store.BASE_PREFS));
    $('srcText').value = '';
    S.demoMode = $('demoMode').checked;
    refreshKeyState();
    updateSplitInfo();
    Profile.localRows = [];
    Profile.refresh();
    toast('本机密钥与记录已清除');
  }
};

/* ---------- 首页分屏指示器与滚轮 -------------------------------------- */
/**
 * 三件事：圆点点击跳转、按可见面积点亮当前屏、滚轮逐段翻页。
 * 吸附的落点仍由 CSS scroll-snap 决定；只有滚轮是例外，理由见 initWheel。
 */
const Landing = {
  io: null,
  ratios: new Map(),
  pages: [],
  cur: null,
  wheelBusy: false,
  wheelAcc: 0,
  wheelAt: 0,

  /** 顶栏高度（CSS 变量是唯一事实来源，JS 只在读不到时兜底） */
  topbarH() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
    return isFinite(v) && v > 0 ? v : 58;
  },

  jump(id) {
    const el = $(id);
    if (!el) return;
    // scrollIntoView 会尊重 scroll-padding-top，落点和吸附位置一致
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  },

  mark(id) {
    $$('.fsdot').forEach(d => {
      if (d.dataset.fs === id) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  },

  init() {
    this.pages = $$('#screen-legacy .fs');
    $$('.fsdot').forEach(d => { d.onclick = () => this.jump(d.dataset.fs); });
    const hint = document.querySelector('.fs-hint');
    if (hint) hint.onclick = () => this.jump(hint.dataset.fs);
    this.initWheel();
    if (!('IntersectionObserver' in window)) return;
    this.io = new IntersectionObserver((entries) => {
      entries.forEach(e => this.ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0));
      let best = null, bestR = 0.2;
      this.ratios.forEach((r, el) => { if (r > bestR) { bestR = r; best = el; } });
      // 取可见面积最大的一屏：大字模式下一屏可能占不满整屏，
      // 所以不能只认固定阈值。全部为 0 说明已经切到别的屏幕。
      this.cur = best;
      this.mark(best ? best.id : '');
    }, {
      threshold: [0, 0.25, 0.55],
      rootMargin: '-' + this.topbarH() + 'px 0px 0px 0px'   // 被顶栏压住的那一条不算可见
    });
    this.pages.forEach(p => this.io.observe(p));
  },

  /* ---------- 滚轮 ------------------------------------------------------ */
  /**
   * Chromium 在 scroll-snap-type:mandatory 下会吞掉滚轮输入：滚完一段就原地卡住，
   * 要挪一下鼠标才恢复。所以这里把「一段」显式化——累计 deltaY 过阈值就跳到相邻段，
   * 跳转动画期间吞掉所有滚轮余量，一次手势只走一段，不跟吸附抢方向盘。
   * 本段内容超过一屏时完全不接管（连同 preventDefault 一起放开），
   * 段内滚动留给大字模式、窄屏和展开后的技术路线。
   */
  initWheel() {
    document.addEventListener('wheel', (e) => {
      if (!document.documentElement.classList.contains('snap-legacy')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;      // 捏合缩放等组合手势交回浏览器
      const i = this.currentIndex();
      if (i < 0) return;
      if (!this.tallerThanViewport(this.pages[i])) {
        e.preventDefault();                                // 吸附点由本函数驱动，不让浏览器半途吞输入
        if (this.wheelBusy) return;
        const now = Date.now();
        // 隔了 180ms 以上就算换了一次手势：否则上一次没攒够的余量会留着，
        // 下次随手一丁点delta 直接凑满阈值、凭空跳一整段。
        if (now - this.wheelAt > 180) this.wheelAcc = 0;
        this.wheelAt = now;
        this.wheelAcc += e.deltaY * this.wheelUnit(e);
        if (Math.abs(this.wheelAcc) < 26) return;          // 滤掉触控板的零碎抖动
        const dir = this.wheelAcc > 0 ? 1 : -1;
        const next = this.pages[i + dir];
        this.wheelAcc = 0;
        if (!next) return;                                 // 已经在首屏或末屏，没有待去的一段
        this.wheelBusy = true;
        this.jump(next.id);
        setTimeout(() => { this.wheelBusy = false; }, prefersStill() ? 150 : 520);
      }
    }, { passive: false });
  },

  /** deltaMode：0 按像素、1 按行、2 按页，Firefox 走按行 */
  wheelUnit(e) {
    return e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  },

  /**
   * 当前停靠的是第几段：按「段顶离吸附线最近」判定，同步且唯一。
   * 吸附线现在就是视口顶（段背景要铺到顶栏背后，见 landing.css 第 1 节），
   * 留 4px 容差，免得停在两段之间时相邻两段的距离打平。
   * 不用观察器算出的可见面积最大者：那个值要等回调，滚轮连着来时是旧的，
   * 拿旧下标去算相邻段就会跳错。观察器那份只管圆点高亮。
   */
  currentIndex() {
    const line = 4;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.pages.length; i++) {
      const d = Math.abs(this.pages[i].getBoundingClientRect().top - line);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  },

  /** 本段是否比视口还高：是的话段内还要滚，不能抢 */
  tallerThanViewport(el) {
    return el.getBoundingClientRect().height > window.innerHeight + 2;
  }
};

/* ---------- 阶段 3：输入方式标签页 ------------------------------------ */
/**
 * 严格按 WAI-ARIA Tabs 做：选中标签 tabindex=0、其余 -1，所以 Tab 键只会停在标签行一处；
 * 左右键切换是「自动激活」，按下去就换页，不需要再补 Enter。
 * 面板切换只用 hidden 属性，不混 display 类：焦点与读屏行为都跟着原生语义走。
 */
const InputTabs = {
  tabs: [],
  select(i, focus) {
    const n = this.tabs.length;
    if (!n) return;
    const k = ((i % n) + n) % n;
    this.tabs.forEach((t, j) => {
      const on = j === k;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panel = $(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus !== false) this.tabs[k].focus();
    // 练习册面板在「开始练习」之后可能多了新条目：每次切到它都重绘一遍，
    // 否则刚练过的内容要等下一次搜索输入才出现。
    if (this.tabs[k].id === 'tabBook') Book.render($('bookSearch').value);
    Store.savePrefs({ inputTab: this.tabs[k].id });
  },
  /** OCR 出来的文字落在文本框里，识别成功后必须把那页翻到眼前，否则用户只看到「识别成功」却看不见内容 */
  showText() {
    const i = this.tabs.findIndex(t => t.getAttribute('aria-controls') === 'panel-text');
    if (i > -1) this.select(i, false);
  },
  init() {
    this.tabs = $$('#screen-setup [role="tab"]');
    if (!this.tabs.length) return;
    this.tabs.forEach((t, i) => {
      t.onclick = () => this.select(i);
      t.onkeydown = (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); this.select(i + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); this.select(i - 1); }
        else if (e.key === 'Home') { e.preventDefault(); this.select(0); }
        else if (e.key === 'End') { e.preventDefault(); this.select(this.tabs.length - 1); }
      };
    });
    const last = this.tabs.findIndex(t => t.id === Store.prefs().inputTab);
    this.select(last > 0 ? last : 0, false);   // 回填上次停留的标签，但不抢焦点
  }
};

/* ---------- 阶段 3：便签式练习设置 ------------------------------------ */
/**
 * 折叠与动画全部由 CSS 按 aria-expanded 驱动（grid-template-rows 0fr→1fr + visibility 延后），
 * 所以这里只翻一个属性：展开状态、读屏播报、Tab 可达性天然一致，不会有第二份状态要同步。
 */
const NoteSheet = {
  init() {
    const btn = $('noteToggle');
    if (!btn) return;
    btn.onclick = () => {
      btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    };
  }
};

/* ---------- 练习册 ------------------------------------------------ */
/**
 * 内置示例（SAMPLES）排前、本机练过的原文排后，搜索按标题与正文一起过滤。
 * 选中模型：点一条 = 选中（高亮保持，不跳页、不填文本框），再点同一条 = 取消；
 * startPractice 优先用选中的内容，文本框里新输入/OCR 出的内容会把选中清掉。
 * 列表每次搜索都整块重绘：条目少（≤63 条），重绘比重排 DOM 简单得多，
 * 也不会留下「改了一行就忘了同步另一行」的隐藏状态。
 */
const Book = {
  items: [],
  selectedText: null,
  selectedBuiltTitle: null,   // 选中的是「内置」条目时记下标题：startPractice 据此认出它其实是一本教材
  /** 选中/取消练习册条目：正文与内置标题一次写，不会出现一个更新、一个留在上一次的 */
  select(text, builtTitle) {
    this.selectedText = text;
    this.selectedBuiltTitle = text == null ? null : (builtTitle || null);
  },
  /** 底部「下滑查看更多」渐隐只在该列表还有内容没滚出来时显示 */
  updateScrollHint() {
    const list = $('bookList'), fade = $('bookFade');
    if (!list || !fade) return;
    const more = list.scrollHeight - list.scrollTop - list.clientHeight > 6;
    fade.classList.toggle('show', more);
  },
  render(filter) {
    const q = (filter || '').trim().toLowerCase();
    const built = [
      { title: '岳阳楼记（名篇背诵）', text: SAMPLES.yyl, built: true },
      { title: '英语课文（单词拼写）', text: SAMPLES.en, built: true },
      { title: '长者认知训练（生活常识）', text: SAMPLES.old, built: true }
    ];
    const own = Store.book().map(e => ({ title: e.title, text: e.text, built: false }));
    this.items = built.concat(own);
    const shown = [];
    this.items.forEach((e, i) => {
      if (!q || (e.title + '\n' + e.text).toLowerCase().indexOf(q) > -1) shown.push(i);
    });
    $('bookCount').textContent = shown.length + ' 条';
    if (!shown.length) {
      $('bookList').innerHTML = '<p class="muted small" style="margin:10px 0 0">没有匹配的条目。</p>';
      this.updateScrollHint();
      return;
    }
    $('bookList').innerHTML = shown.map(i => {
      const e = this.items[i];
      const prev = e.text.replace(/\s+/g, ' ').slice(0,60);
      const on = e.text === this.selectedText;
      return '<button type="button" class="book-item' + (on ? ' on' : '') + '" data-i="' + i + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="book-tag">' + (e.built ? '内置' : '本机') + '</span>' +
        '<span class="book-title">' + escapeHtml(e.title) + '</span>' +
        '<span class="book-prev">' + escapeHtml(prev) + '</span>' +
        '</button>';
    }).join('');
    $$('#bookList .book-item').forEach(btn => btn.onclick = () => {
      const e = this.items[Number(btn.dataset.i)];
      if (!e) return;
      const wasOn = btn.getAttribute('aria-pressed') === 'true';
      this.select(wasOn ? null : e.text, e.built ? e.title : null);
      this.render($('bookSearch').value);   // 重绘以更新高亮，保留当前搜索词
      updateSplitInfo();
      toast(wasOn ? '已取消选中' : '已选中「' + e.title + '」，点「开始练习」即可');
    });
    this.updateScrollHint();
  },
  init() {
    const search = $('bookSearch');
    if (!search) return;
    search.addEventListener('input', () => this.render(search.value));
    $('bookList').addEventListener('scroll', () => this.updateScrollHint());
    this.render('');
  }
};

/* ---------- 阶段 3：手写体与降级 -------------------------------------- */
/**
 * 霞鹜文楷按 unicode-range 切成很多分片，只有真正用到才下载，所以必须显式点一段中文，
 * 不能只靠 document.fonts.check。取不到只是字形退回系统楷体/黑体，功能一行都不动，
 * 因此这里永不抛错、永不拦渲染，也把结论如实写进便签里那句话。
 */
const Fonts = {
  handReady: null,                       // null=还没结论，true/false=探测结果
  apply() {
    const want = !!$('fontStyle') && $('fontStyle').value === 'hand';
    // 结论没回来之前先按手写体排（浏览器自带 FOUT 兜底），别让用户先看到黑体再抖一下
    const useHand = want && this.handReady !== false;
    document.documentElement.classList.toggle('no-hand', !useHand);
    const st = $('fontState');
    if (!st) return;
    if (!want) st.textContent = '当前是清晰黑体：正文与默写页都用系统黑体，行距同步收紧，随时可以切回手写体。';
    else if (this.handReady === false) st.textContent = '本机没能取到手写体字形（通常是网络原因），已自动退回系统楷体；这只影响字形，不影响任何功能。';
    else st.textContent = '手写体的字形要联网取一次，取不到会自动退回系统楷体，只影响字形，不影响任何功能。';
  },
  probe() {
    const done = (ok) => { this.handReady = ok; this.apply(); };
    if (!document.fonts || !document.fonts.load) { done(false); return; }
    const load = document.fonts.load('1em "LXGW WenKai"', '记忆练习助手岳阳楼记')
      .then(faces => !!(faces && faces.length));
    // 3 秒不返回就当取不到：评委网络差时也绝不能卡在「正在加载字体」
    const timer = new Promise(res => setTimeout(() => res(false), 3000));
    Promise.race([load.catch(() => false), timer]).then(done);
  },
  init() {
    const sel = $('fontStyle');
    if (sel) sel.addEventListener('change', () => { saveCfg(); this.apply(); });
    this.apply();
    // 字体样式表是 media=print 异步挂上的，boot 时常常还没解析完，所以要等整页 load 再探
    if (document.readyState === 'complete') this.probe();
    else window.addEventListener('load', () => this.probe(), { once: true });
  }
};

/* ---------- 工作台 ------------------------------------------------ */
/**
 * 工作台是新的默认首页，两栏布局：
 *   左栏「学习新知识」：四种来源卡片 + 我的教材列表 + 继续学习按钮
 *   右栏「复习今日」：间隔复习队列，一次一张卡片
 *
 * 阶段 2：打通粘贴文本和内置讲义入口，IndexedDB 存储教材。
 */
const Workbench = {
  docs: [],  // 当前教材列表

  async init() {
    // UI 绑定不依赖 IndexedDB：即使 DB 打不开，四个卡片与粘贴弹窗也必须能点，
    // 否则会把「生成教材」的入口一起拖没（init 的 await 链一抛错，后面的绑定就不执行了）。
    this.bindPasteModal();
    this.renderProgress();
    await this.loadDocs();
    this.renderDocs();
    await this.refreshReview();
  },

  /** 从 IndexedDB 加载教材列表 */
  async loadDocs() {
    try {
      this.docs = await DB.listDocuments();
      // 按创建时间倒序
      this.docs.sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      console.warn('加载教材失败:', e);
      this.docs = [];
    }
  },

  /** 左栏：渲染我的教材列表 */
  renderDocs() {
    const box = $('wbDocsList');
    if (!box) return;
    if (!this.docs.length) {
      box.innerHTML = '<p class="muted small" style="margin:12px 0">还没有教材，点击上方卡片开始添加。</p>';
      return;
    }
    box.innerHTML = this.docs.map(doc => {
      const segCount = doc.segments ? doc.segments.length : 0;
      const date = new Date(doc.createdAt).toLocaleDateString('zh-CN');
      return `<button type="button" class="wb-doc-item" data-docid="${doc.docId}">
        <div class="wb-doc-title">${escapeHtml(doc.title)}</div>
        <div class="wb-doc-meta">${segCount} 段 · ${date} · ${doc.source === 'builtin' ? '内置' : '自创'}</div>
      </button>`;
    }).join('');
    // 绑定点击事件
    box.querySelectorAll('.wb-doc-item').forEach(btn => {
      btn.onclick = () => this.openDoc(btn.dataset.docid);
    });
  },

  /**
   * 把一段原文落到一本真教材上，返回 docId：已有就用已有的，没有就按同一套规则生成。
   * 内置讲义第一次从练习册进来时走这里——没有 docId，onSegmentDone 在源头就 return，
   * 「完成检查点」写得再对也排不进复习计划，这就是内置与自定义表现不一致的地方。
   */
  async resolveDocument(raw, title) {
    if (!this.docs.length) await this.loadDocs();
    const flat = s => String(s || '').replace(/\s+/g, '');
    const want = flat(raw);
    let hit = this.docs.find(d => d.title === title) ||
              this.docs.find(d => flat((d.segments || []).map(x => x.text).join('')) === want);
    if (hit) return hit.docId;
    hit = await this.generateDocument(raw, title || String(raw).trim().slice(0, 10), 'builtin');
    await DB.saveDocument(hit);
    await this.loadDocs();
    this.renderDocs();
    return hit.docId;
  },

  /** 打开教材进入学习 */
  async openDoc(docId) {
    let doc = null;
    try {
      doc = await DB.getDocument(docId);
    } catch (e) {
      toast('打开教材失败：' + (e && e.message ? e.message : e), 'err');
      return;
    }
    if (!doc || !Array.isArray(doc.segments) || !doc.segments.length) {
      toast('教材数据为空或已损坏，请重新生成', 'warn');
      return;
    }
    // 阶段 3：段落 id 与检查点对齐，onSegmentDone 靠 segmentId 找回本段的检查点
    let cps = [];
    try {
      cps = await Review.ensureCheckpoints(doc);
    } catch (e) {
      console.warn('检查点生成失败', e);
    }
    S.docId = doc.docId;
    S.checkpoints = cps;
    S.segments = doc.segments.map((seg, i) => {
      const segId = seg.id || (doc.docId + '-s' + i);
      const own = cps.filter(c => c.segmentId === segId).map(c => c.answer);
      return {
        id: segId,
        text: seg.text,
        chars: Array.from(seg.text),
        // 直接用检查点的答案当关键词：练习页挖的空和复习题考的空就是同一个词
        keywords: own.length ? own : null,
        blanks: [],
        hintsUsed: 0
      };
    });
    S.idx = 0;
    S.startedAt = Date.now();
    S.errTotal = 0;
    S.hintUsed = 0;
    S.quizTry = 0;
    S.quizDone = true;  // 跳过闯关
    S.quizResult = 'none';
    S.inPractice = true;
    S.checkpointAt = Infinity;
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
    await loadSegment(0);
    toast('共 ' + doc.segments.length + ' 段，把灰框里的空凭记忆填上');
  },

  /** 左栏：当前进度（阶段 2 显示空态） */
  renderProgress() {
    const box = $('wbProgress');
    if (!box) return;
    box.hidden = true;
  },

  /** 右栏：复习今日（阶段 3 接艾宾浩斯队列） */
  async refreshReview() {
    if (typeof Review === 'undefined') return;
    try {
      await Review.refresh();
    } catch (e) {
      // 队列读不出来时退回空态，不能让右栏停在上一批数据上，也不能卡住工作台
      console.warn('复习队列加载失败', e);
      const empty = $('wbReviewEmpty');
      const card = $('wbReviewCard');
      if (card) card.hidden = true;
      if (empty) empty.style.display = '';
    }
  },

  /** 绑定粘贴文本浮层 */
  bindPasteModal() {
    const veil = $('pasteVeil');
    if (!veil) return;
    const textarea = $('pasteText');
    const info = $('pasteInfo');
    const titleInput = $('pasteTitleInput');

    // 打开浮层
    $('wbSrcPaste').onclick = () => {
      textarea.value = '';
      titleInput.value = '';
      info.textContent = '已输入 0 字';
      veil.classList.add('on');
      textarea.focus();
    };

    // 实时字数统计
    textarea.oninput = () => {
      info.textContent = '已输入 ' + textarea.value.length + ' 字';
    };

    // 取消
    $('pasteCancel').onclick = () => {
      veil.classList.remove('on');
    };

    // 确认生成
    $('pasteConfirm').onclick = async () => {
      const text = textarea.value.trim();
      if (!text) { toast('请先粘贴文字', 'warn'); return; }
      if (text.length < 20) { toast('文字太短，至少 20 字', 'warn'); return; }
      const title = titleInput.value.trim() || text.trim().slice(0, 10);

      veil.classList.remove('on');
      showVeil('正在生成教材…', '系统正在按 40-80 字切段，请稍候。');
      
      try {
        const doc = await this.generateDocument(text, title, 'paste');
        await DB.saveDocument(doc);
        await this.loadDocs();
        this.renderDocs();
        hideVeil();
        toast('教材已生成：' + doc.segments.length + ' 段，点击即可学习');
      } catch (e) {
        hideVeil();
        toast('生成失败：' + (e.message || e), 'err');
        console.error(e);
      }
    };

    // 内置讲义
    $('wbSrcBuilt').onclick = async () => {
      showVeil('正在加载内置讲义…', '系统正在生成检查点，请稍候。');
      try {
        // 加载三节内置讲义
        const builtins = [
          { title: '岳阳楼记（名篇背诵）', text: SAMPLES.yyl },
          { title: '英语课文（单词拼写）', text: SAMPLES.en },
          { title: '长者认知训练（生活常识）', text: SAMPLES.old }
        ];
        for (const item of builtins) {
          // 检查是否已存在
          const existing = this.docs.find(d => d.title === item.title && d.source === 'builtin');
          if (existing) continue;
          const doc = await this.generateDocument(item.text, item.title, 'builtin');
          await DB.saveDocument(doc);
        }
        await this.loadDocs();
        this.renderDocs();
        hideVeil();
        // 播完种就进第一节的学习界面。以前只 toast 一句「内置讲义已加载」就停在首页：
        // 想学只能绕道练习册，而那条路没有 docId，检查点永远排不进复习计划。
        const first = this.docs.find(d => d.source === 'builtin' && d.title === builtins[0].title);
        if (first) await this.openDoc(first.docId);
        else toast('内置讲义已加载，请在「我的教材」里选择');
      } catch (e) {
        hideVeil();
        toast('加载失败：' + (e.message || e), 'err');
        console.error(e);
      }
    };

    // OCR 和 我的教材 暂时跳转到旧流程
    $('wbSrcOcr').onclick = () => { go('setup'); if (typeof InputTabs !== 'undefined') { const i = InputTabs.tabs.findIndex(t => t.id === 'tabOcr'); if (i > -1) InputTabs.select(i); } };
    $('wbSrcBook').onclick = () => { go('setup'); if (typeof InputTabs !== 'undefined') { const i = InputTabs.tabs.findIndex(t => t.id === 'tabBook'); if (i > -1) InputTabs.select(i); } };

    // ESC 关闭浮层
    veil.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { veil.classList.remove('on'); }
      if (e.key === 'Tab') trapTab(e, veil);
    });

    // 临时调试：只拨快时钟，不动任何记录。演示前删掉这一段与 index.html 的 .wb-review-debug
    [['wbShiftDay', () => Review.shiftOneDay()], ['wbClockReset', () => Review.resetClock()]].forEach(pair => {
      const btn = $(pair[0]);
      if (!btn) return;
      btn.onclick = async () => {
        btn.setAttribute('aria-disabled', 'true');
        try {
          await pair[1]();
        } catch (e) {
          toast('调试时钟操作失败：' + (e && e.message ? e.message : e), 'err');
        } finally {
          btn.removeAttribute('aria-disabled');
        }
      };
    });
  },

  /**
   * 生成教材：切段
   * 复用现有 splitSegments() 逻辑，关键词提取交给练习流程的 loadSegment()
   */
  async generateDocument(text, title, source) {
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const segments = splitSegments(text);
    
    if (!segments.length) throw new Error('文本太短，无法分段');
    
    const segObjs = segments.map((segText, i) => ({
      id: docId + '_seg_' + i,
      text: segText,
      order: i
    }));

    // 阶段 3：检查点与段落一起落库，复习队列才不用每次练习时重新推导
    const doc = {
      docId: docId,
      title: title,
      source: source,  // 'paste' | 'builtin' | 'ocr'
      segments: segObjs,
      checkpoints: [],
      createdAt: Date.now()
    };
    doc.checkpoints = Review.buildCheckpoints(doc);
    return doc;
  }
};

/* ---------- 事件绑定 -------------------------------------------------- */
function bind() {
  // 顶栏三个主入口 + 登录态胶囊
  $('navWorkbench').onclick = () => go('workbench');
  $('navPractice').onclick = () => go('setup');
  $('navProfile').onclick = () => { go('profile'); Profile.refresh(); };
  $('authChip').onclick = () => {
    if (S.account.signedIn) { go('profile'); Profile.refresh(); } else { go('auth'); App.renderAuthMode(); }
  };

  // 四个来源卡片的绑定统一在 Workbench.bindPasteModal 里做。
  // 这里绝不能再绑一次：重复 onclick 赋值会因执行顺序互相覆盖，是「点了没反应 / 打开的不是弹窗」的根源。

  // 工作台：继续学习 & 底部入口
  if ($('wbContinue')) $('wbContinue').onclick = () => { go('setup'); };
  if ($('wbGoLegacy')) $('wbGoLegacy').onclick = () => go('legacy');
  if ($('backToWorkbench')) $('backToWorkbench').onclick = () => go('workbench');

  // 旧首页（产品介绍）按钮
  if ($('goSetupLegacy')) $('goSetupLegacy').onclick = () => { go('setup'); };
  if ($('goSetupDemoLegacy')) $('goSetupDemoLegacy').onclick = () => {
    $('demoMode').checked = true;
    S.demoMode = true;
    saveCfg();
    refreshKeyState();
    go('setup');
    toast('已开启演示模式：使用本地算法，无需 API Key');
  };
  // 准备页 → 个人中心的模型配置跳转入口
  $('goModelCfg').addEventListener('click', e => { e.preventDefault(); go('profile'); });

  // 配置
  ['hfToken', 'groqKey', 'ocrModel', 'groqModel', 'chunk'].forEach(id => $(id).addEventListener('change', () => { saveCfg(); refreshKeyState(); updateSplitInfo(); }));
  ['optCloze', 'optQuiz', 'optBig', 'optSpeak'].forEach(id => $(id).addEventListener('change', () => { saveCfg(); }));
  $('demoMode').addEventListener('change', () => { S.demoMode = $('demoMode').checked; refreshKeyState(); saveCfg(); });
  $('rememberKeys').addEventListener('change', () => {
    if (!$('rememberKeys').checked) { Store.clearSecrets(); refreshKeyState(); toast('已从本机清除密钥，输入框也已清空'); }
    else saveCfg();
  });
  $('btnClearKeys').onclick = () => { Store.clearSecrets(); refreshKeyState(); toast('密钥已清除（只影响本机）'); };
  $('backHome').onclick = () => go('workbench');
  $('srcText').addEventListener('input', () => {
    if (typeof Book !== 'undefined' && Book.selectedText !== null) {
      Book.select(null);
      Book.render($('bookSearch').value);   // 高亮要跟着取消，不能只在内存里清
    }
    updateSplitInfo();
  });

  // 示例
  $$('.chip[data-sample]').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.sample;
    $('srcText').value = k === 'clear' ? '' : SAMPLES[k];
    if (typeof Book !== 'undefined') { Book.select(null); Book.render($('bookSearch').value); }
    updateSplitInfo();
  });

  // 粘贴文本 → 加入练习册（带标题）
  $('btnAddBook').onclick = () => {
    const text = $('srcText').value.trim();
    if (!text) { toast('先粘贴或输入一段文字，再加入练习册', 'warn'); return; }
    const title = $('textTitle').value.trim();
    Store.addToBook(text, title || undefined);
    Book.render($('bookSearch').value);
    toast(title ? '已加入练习册：' + title : '已加入练习册（标题取正文首行）');
  };

  // 图片 OCR
  let thumbUrl = '';
  $('btnUploadPick').onclick = () => { $('imgFile').dataset.ocr = '1'; $('imgFile').click(); };
  $('btnOcrFileInput').onclick = () => { $('imgFile').dataset.ocr = '0'; $('imgFile').click(); };
  $('imgFile').addEventListener('change', async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) return;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(f);
    $('thumb').src = thumbUrl;
    $('thumb').style.display = 'block';
    $('ocrState').textContent = '已选择：' + f.name;
    if (input.dataset.ocr === '0') {
      $('ocrState').textContent = '已选择：' + f.name + '（未识别）';
      input.value = '';
      return;
    }
    const token = $('hfToken').value.trim();
    if (!token) {
      $('ocrState').textContent = '已选择：' + f.name + '（缺少 Token，未识别）';
      toast('未填写 Hugging Face Token，无法在线识别。可切到「粘贴文本」标签页直接贴入内容。', 'warn');
      input.value = '';
      return;
    }
    showVeil('正在识别图片中的文字…', '首次调用可能需要模型冷启动，最长约 1 分钟。');
    try {
      const txt = await hfOcr(f, token, $('ocrModel').value.trim(), $('ocrEngine').value);
      const tidy = tidyOcrText(txt);
      $('srcText').value = $('srcText').value.trim() ? $('srcText').value.trim() + '\n' + tidy : tidy;
      if (typeof Book !== 'undefined') { Book.select(null); Book.render($('bookSearch').value); }   // 新识别的内容替代练习册选中项
      InputTabs.showText();          // 结果在「粘贴文本」页里，不把那页翻出来用户看不见
      $('ocrState').textContent = '识别成功：' + tidy.length + ' 字';
      updateSplitInfo();
      toast('已识别 ' + tidy.length + ' 个字，已切到「粘贴文本」页，请检查是否准确');
    } catch (err) {
      $('ocrState').textContent = '识别失败';
      toast('识别失败：' + friendlyErr(err) + '（也可切到「粘贴文本」标签页，把文字手动贴进去）', 'err');
    } finally { hideVeil(); input.value = ''; }
  });

  // 练习：空位是逐个渲染出来自己挂监听的，这里只管三个按钮
  $('btnStart').onclick = startPractice;
  // 「下一段」不再用原生 disabled：那种按钮不派发 click，点了就是真没反应。
  // 现在永远可点，未就绪时由 advanceSegment 报出是哪几个空、并把焦点挪过去。
  $('btnNext').onclick = () => advanceSegment();
  $('btnReveal').onclick = () => hintOnce();
  $('btnSpeak').onclick = () => curSeg && speak(curSeg.text);
  $('btnQuit').onclick = () => {
    if (!S.inPractice) return;
    if (!confirm('确定退出本次练习吗？本次已练习的进度会作为「中途退出」记录保存。')) return;
    clearInterval(S.timerId);
    // 闯关题还开着就退出：必须关掉遮罩并解开等待，否则回到准备页会被浮层盖住；
    // 没答过的题记为「已跳过」，不能算成「答错了」。
    if ($('quizVeil').classList.contains('on')) {
      if (!S.quizResult) S.quizResult = 'skipped';
      closeQuizVeil('quit');
    }
    S.inPractice = false;
    curSeg = null;
    activeBlank = null;
    advancing = false;
    App.persist(false);
    go('setup');
  };
  $('optBig').addEventListener('change', () => {
    document.documentElement.style.setProperty('--fs', $('optBig').checked ? '22px' : '18px');
    // 行内空的宽度是按字符逐字算好的 em，大字模式下还要加高下划线，否则三字词会挤成横向滚动条
    document.documentElement.classList.toggle('t-big', $('optBig').checked);
  });

  // 报告
  $('btnAgain').onclick = () => startPractice();
  $('btnNewText').onclick = () => go('setup');
  $('btnHome2').onclick = () => go('workbench');

  // 账号页
  $('tabEmail').onclick = () => App.setAuthTab('email');
  $('tabPhone').onclick = () => App.setAuthTab('phone');
  $('btnSignin').onclick = () => { if (App.formMode === 'signup') App.setFormMode('signin'); else App.doSignin(); };
  $('btnSignup').onclick = () => { if (App.formMode === 'signup') App.doSignup(); else App.setFormMode('signup'); };
  $('btnForgot').onclick = () => App.doForgot();
  $('btnSendOtp').onclick = () => App.doSendOtp();
  $('btnVerifyOtp').onclick = () => App.doVerifyOtp();
  $('authBack').onclick = () => go('workbench');
  const submitEmailForm = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (App.formMode === 'signup') App.doSignup(); else App.doSignin();
  };
  $('authEmail').addEventListener('keydown', submitEmailForm);
  $('authPwd').addEventListener('keydown', submitEmailForm);
  $('authOtp').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); App.doVerifyOtp(); } });
  $('btnSavePwd').onclick = () => App.doSaveNewPwd();
  $('btnSkipRecover').onclick = () => { $('recoverCard').hidden = true; try { localStorage.removeItem(Auth.PENDING_RESET); } catch (e) {} };

  // 个人中心
  $('pGoAuth').onclick = () => { go('auth'); App.renderAuthMode(); };
  $('pGoLearn').onclick = () => go('setup');
  $('pAvatar').addEventListener('change', () => { S.account.avatarKey = $('pAvatar').value; Profile.renderAvatar(); });
  $('btnSaveProfile').onclick = () => Profile.saveProfile();
  $('btnSyncLocal').onclick = () => Profile.syncNow(false);
  $('btnRename').onclick = () => Profile.renameDetail();
  $('btnDeleteSession').onclick = () => Profile.deleteDetail();
  $('detailClose').onclick = () => Profile.closeDetail();
  $('detailTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); Profile.renameDetail(); } });
  $('btnLogout').onclick = () => App.doSignout();
  $('btnClearLocal').onclick = () => App.clearLocal();

  // 本机记录同步面板
  $('btnMigrateYes').onclick = async () => { await Profile.syncNow(true); Profile.closeSheet(); };
  $('btnMigrateNo').onclick = () => {
    Store.write(Store.key(Store.BASE_PROMPT), true);   // 记下来，下次登录不再重复弹窗；个人中心里随时能手动同步
    Profile.closeSheet();
    toast('已跳过同步，记录继续留在本机；需要时可在个人中心点「把本机记录传到云端」', 'warn');
  };

  // 课本化界面（阶段 3）
  InputTabs.init();
  NoteSheet.init();
  if (typeof P3 !== 'undefined') P3.init();   // 三栏壳的抽屉按钮（宽屏时按钮由 CSS 隐藏）
  Fonts.init();

  // 全局快捷键：Esc 退出练习。请求中的 Loading 遮罩与同步面板仍然吞掉 Esc（那时打断会造成脏状态），
  // 但闯关浮层不再无条件吞：浮层里只有「提交/跳过」两条路，Esc 至少要把「退出练习」这条路留给键盘用户。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('veil').classList.contains('on') || $('migrateVeil').classList.contains('on')) return;
    // 窄屏抽屉开着时 Esc 先关抽屉，不能顺手把整场练习退掉
    if (typeof P3 !== 'undefined' && P3.isOpen()) { P3.close(); return; }
    if ($('screen-practice').classList.contains('on')) $('btnQuit').click();
  });
  // 闯关浮层是模态的：Tab 圈在浮层内，关掉之后焦点由 closeQuizVeil 还回来
  $('quizVeil').addEventListener('keydown', (e) => { if (e.key === 'Tab') trapTab(e, $('quizVeil')); });
  $('migrateVeil').addEventListener('keydown', (e) => { if (e.key === 'Tab') trapTab(e, $('migrateVeil')); });
  $('qSubmit').onclick = submitQuiz;
  $('qSkipBtn').onclick = () => { S.quizResult = 'skipped'; closeQuizVeil('skipped'); toast('已跳过本题'); };
}

/** 分段预览，让用户在开始前对段数有预期 */
function updateSplitInfo() {
  // 练习册有选中项时按选中项估算；文本框里的新输入/OCR 结果会把选中项清掉，自然回退到文本框
  const raw = ((typeof Book !== 'undefined' && Book.selectedText) || $('srcText').value).trim();
  if (!raw) { $('splitInfo').textContent = ''; return; }
  const n = splitSegments(raw).length;
  $('splitInfo').textContent = '当前文本约 ' + raw.length + ' 字 → 将切成 ' + n + ' 段练习，第 ' + Math.max(1, Math.round(n * 0.5)) + ' 段后触发闯关测验';
}

/* ---------- 启动 ------------------------------------------------------ */
(async function boot() {
  AppConfig.load();
  Auth.init();
  Cloud.init();
  loadCfg();
  S.demoMode = $('demoMode').checked;
  bind();
  Book.init();
  // 工作台是默认首页，不使用分屏吸附；旧产品介绍页（#screen-legacy）才用吸附
  document.documentElement.classList.remove('snap-legacy');
  Landing.init();
  if (typeof Workbench !== 'undefined') Workbench.init();
  refreshKeyState();
  App.renderAuthMode();
  App.renderChip();
  // 地址通不通、表建没建，只影响一行提示，所以放在后台跑，不阻塞首屏与算法
  AppConfig.check().then(() => { App.renderChip(); App.renderAuthMode(); });

  let session = null;
  try {
    session = await Auth.restore();
    if (!session) { Store.setAccount(null); App.renderChip(); }
  } catch (e) {
    // 恢复失败绝不能拖垮算法演示：退回本地模式，页面照常可用
    AppConfig.enabled = false;
    Auth.enabled = false;
    AppConfig.reason = '账号服务初始化失败（' + (e && e.message ? e.message : e) + '）';
    App.renderChip();
    App.renderAuthMode();
  }

  // restore() 里记下的事实（换设备点邮件链接失败、账号已不存在…）必须让用户看到，
  // 只存在变量里等于没说。
  if (Auth.note) { toast(Auth.note, 'warn'); Auth.note = ''; }

  // 邮件重置链接落地：会话已换到手且本机存着重置标记，就请用户设置新密码
  let pending = '';
  try { pending = localStorage.getItem(Auth.PENDING_RESET) || ''; } catch (e) {}
  if (session && pending === '1') {
    $('recoverCard').hidden = false;
    go('auth');
    toast('身份已验证，请设置新密码');
    await App.afterSignIn(false);
  } else if (session) {
    await App.afterSignIn(false);
  }

  // 预加载语音列表（部分浏览器需异步才有结果）
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
})();
