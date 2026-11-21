/* ---------- I. 账号体系（Supabase Auth） -------------------------------- */
/**
 * 设计原则
 * 1. 密码只交给 Supabase Auth。本文件不会把密码写进 localStorage、数据表、
 *    控制台日志或任何请求体里。updateUser 走的是官方 token 交换。
 * 2. 只使用 anon key（前端公钥）。它的所有权限完全由 RLS 策略约束，
 *    未登录（anon）身份读不到任何人的数据，因此泄露也无法越权。
 * 3. 后端不可用不等于演示不可用。AppConfig.enabled 为 false 时这里全部方法
 *    直接返回「未启用」，练习流程与本地算法完全不受影响。
 */
const Auth = {
  client: null,
  enabled: false,
  session: null,
  busy: false,           // 防止连点重复提交
  note: '',              // 最近一次需要向用户说明的、非「错误」的事实
  PENDING_RESET: 'memtr…set',

  /* ---------- 初始化与恢复 ---------- */

  /** 创建客户端并订阅登录态变化。AppConfig 判定不可用时什么都不做。 */
  init() {
    this.enabled = AppConfig.enabled;
    if (!this.enabled) return false;
    this.client = supabase.createClient(AppConfig.url, AppConfig.anonKey, {
      auth: {
        flowType: 'pkce',              // 授权码 + PKCE，邮件链接换 token 时不暴露密钥
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,      // 自动处理邮件链接带回的 ?code=
        storageKey: 'memtrainer-auth'
      }
    });
    this.client.auth.onAuthStateChange((event, session) => {
      this.session = session;
      if (typeof App !== 'undefined') App.onAuthState(event, session);
    });
    return true;
  },

  /**
   * 启动时恢复会话。顺序很重要：
   * 先让 SDK 处理 URL 里的 code（detectSessionInUrl 已在 init 时启动），
   * 拿不到会话再自己换一次，最后把 URL 上的 code/state/error 参数清干净，
   * 避免用户刷新页面时重复使用同一个一次性授权码。
   */
  async restore() {
    if (!this.enabled) return null;
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    const authErr = q.get('error_description') || q.get('error');
    let session = this.session;
    if (!session) session = (await this.client.auth.getSession()).data.session;

    if (!session && code) {
      try {
        session = (await this.client.auth.exchangeCodeForSession(code)).data.session;
      } catch (e) {
        // 授权码存在发起请求那台浏览器的 localStorage 里，换设备点邮件链接必然失败，
        // 这一点必须在 UI 上如实说明，而不是笼统报「登录失败」。
        this.note = '邮件链接没能完成验证：' + this.errText(e) +
          '。请在发起操作的同一台电脑、同一个浏览器里点开邮件中的链接。';
      }
    }
    if (authErr && !this.note) this.note = '邮件链接返回的问题：' + authErr;

    if (code || q.get('state') || authErr) history.replaceState({}, '', location.pathname);

    if (session) {
      // 本机存的会话只代表「token 还没过期」，不代表账号还在：管理员删号或用户注销后，
      // 顶栏会一直挂着「已登录」，而每次云端读写都在后台悄悄失败。
      // 所以启动时向服务端确认一次。连不上不等于账号没了 —— 那种情况保留会话，
      // reach 探测会另行说明「未连接」，绝不能把网络抖动误判成注销。
      let gone = false;
      try {
        const v = await this.client.auth.getUser();
        gone = !!(v.error && /user from sub claim|invalid user|user not found/
          .test(String(v.error.message || '').toLowerCase()));
      } catch (e) { gone = false; }
      if (gone) {
        this.note = '这个账号在服务器上已经不存在（可能被删除或注销），已退出登录；本机记录仍然保留在这台浏览器。';
        await this.client.auth.signOut({ scope: 'local' });
        session = null;
      }
    }
    if (session) { this.session = session; this.apply(session); }
    return session;
  },

  /** 把会话里的身份信息同步到全局状态与本机存储命名空间 */
  apply(session) {
    const u = session && session.user;
    S.account.signedIn = !!u;
    S.account.userId = u ? u.id : null;
    S.account.email = u ? (u.email || '') : '';
    S.account.nickname = (u && u.user_metadata && u.user_metadata.nickname) || '';
    Store.setAccount(S.account.userId);
  },

  /* ---------- 表单校验 ---------- */
  validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); },
  validPwd(v) { return v.length >= 8; },
  validPhone(v) { return /^\+[1-9]\d{5,14}$/.test(v.replace(/[\s-]/g, '')); },

  /** Supabase 返回的英文错误 -> 中文说明（评审与长辈用户都需要看得懂的原因） */
  errText(error) {
    const raw = (error && (error.message || error.error_description)) || String(error || '未知错误');
    const m = raw.toLowerCase();
    if (/invalid login credentials/.test(m)) return '邮箱或密码不正确';
    if (/email not confirmed/.test(m)) return '该邮箱还没有完成确认';
    if (/already registered|already been registered/.test(m)) return '这个邮箱已经注册过，请直接登录';
    if (/user from sub claim|invalid user|user not found/.test(m)) return '这个账号在服务器上已经不存在（可能被删除或注销）';
    if (/rate limit|too many requests/.test(m)) return '操作过于频繁，请稍后再试（Supabase 有频率限制）';
    if (/password should be at least/.test(m)) return '密码长度不够，至少 8 位';
    if (/unable to validate captcha/.test(m)) return '人机验证未通过';
    if (/invalid or expired code|flow state/.test(m)) return '邮件链接已失效或不是在当前浏览器发起的';
    if (/network|failed to fetch|fetch failed/.test(m)) return '连不上账号服务：可能是本机网络问题，也可能是 js/config.js 里的 Supabase 项目地址填错（当前地址解析不到）。';
    if (/sign-ups are not allowed/.test(m)) return '该 Supabase 项目关闭了注册功能';
    if (/phone.*not.*enabled|provider is not enabled/.test(m)) return 'Supabase 尚未启用手机短信登录服务商';
    return raw.slice(0, 160);
  },

  /** 统一的请求包装：连点时直接拒绝，异常统一转成中文 */
  async call(fn) {
    if (!this.enabled) return { ok: false, off: true, error: '本地模式：尚未配置 Supabase 账号服务' };
    if (this.busy) return { ok: false, error: '请等待上一次操作完成' };
    this.busy = true;
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: this.errText(e) };
    } finally {
      this.busy = false;
    }
  },

  redirectUrl() { return location.origin + location.pathname; },

  /* ---------- 邮箱 + 密码 ---------- */

  /**
   * 注册。若项目开着 Confirm email，Supabase 会返回 session=null，
   * 此时如实告诉用户「确认邮件已发出」，不要假装已经登录成功。
   */
  async signUp(email, pwd, nickname) {
    return this.call(async () => {
      const { data, error } = await this.client.auth.signUp({
        email, password: pwd,
        options: { data: { nickname: nickname || '' }, emailRedirectTo: this.redirectUrl() }
      });
      if (error) throw error;
      return data;
    });
  },

  async signIn(email, pwd) {
    return this.call(async () => {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password: pwd });
      if (error) {
        if (/email not confirmed/i.test(error.message || '')) {
          throw new Error('该邮箱还需要点击确认邮件才能登录。本项目演示环境默认关闭邮箱确认；' +
            '如果你的项目开启了确认，请到 Supabase 控制台 Authentication → Sign In / Providers 关闭它，或让用户重发确认邮件。');
        }
        throw error;
      }
      return data;
    });
  },

  /** 忘记密码：真实调用 resetPasswordForEmail，不承诺邮件一定能收到 */
  async resetPassword(email) {
    const res = await this.call(async () => {
      const { data, error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl() });
      if (error) throw error;
      return data;
    });
    if (res.ok) { try { localStorage.setItem(this.PENDING_RESET, '1'); } catch (e) {} }
    return res;
  },

  /** 重置链接落地后改密码：走 Auth 官方 updateUser，不碰任何数据表 */
  async updatePassword(pwd) {
    return this.call(async () => {
      const { data, error } = await this.client.auth.updateUser({ password: pwd });
      if (error) throw error;
      try { localStorage.removeItem(this.PENDING_RESET); } catch (e) {}
      return data;
    });
  },

  async signOut() {
    return this.call(async () => {
      // scope:'local' 只登出当前浏览器；公用演示机上不会把别的设备一起踢下线。
      const { error } = await this.client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      return true;
    });
  },

  /* ---------- 手机验证码（默认关闭） ---------- */

  sendPhoneOtp(phone) {
    return this.call(async () => {
      const { data, error } = await this.client.auth.signInWithOtp({
        phone, options: { channel: 'sms' }
      });
      if (error) throw error;
      return data;
    });
  },

  verifyPhoneOtp(phone, token) {
    return this.call(async () => {
      const { data, error } = await this.client.auth.verifyOtp({ phone, token, type: 'sms' });
      if (error) throw error;
      return data;
    });
  },

  /** 当前账号昵称（资料读不到时的兜底） */
  nickname() {
    const u = this.session && this.session.user;
    return (u && u.user_metadata && u.user_metadata.nickname) || S.account.nickname || '记忆练习者';
  }
};
