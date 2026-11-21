/**
 * ==========================================================================
 * 后端配置模板（本文件入库，可公开）
 *
 * 用法：把本文件复制一份命名为 config.js，只改 config.js。
 *      config.js 已写进 .gitignore，不会被提交，也不会被打包进代码仓库。
 *
 *      cp web/js/config.example.js web/js/config.js
 *
 * 这里只允许出现 Supabase 的 anon key（前端公钥）。
 *  绝对不要把 service_role key 写进来 —— 它可以绕过 RLS 读写所有人的数据，
 *    任何能打开浏览器的人都能从页面里拿到它。本项目不使用任何服务端密钥。
 *  Hugging Face Token 与 Groq API Key 不写在这里，它们只存在浏览器
 *    localStorage 里（见 js/store.js），代码仓库中永远不出现。
 * ==========================================================================
 */
window.APP_CONFIG = {

  /* ------------------------------------------------------------------
   * 1. Supabase 项目地址
   *    控制台 → Project Settings → API → Project URL
   *    形如 https://abcdefghijklm.supabase.co
   *    留空 = 本地模式（不连接账号服务，功能仍可完整演示）
   * ------------------------------------------------------------------ */
  supabaseUrl: '',

  /* ------------------------------------------------------------------
   * 2. Supabase anon key（前端公钥）
   *    控制台 → Project Settings → API → Project API keys → anon public
   *    留空 = 本地模式
   * ------------------------------------------------------------------ */
  supabaseAnonKey: '',

  /* ------------------------------------------------------------------
   * 3. 手机号验证码登录开关（默认关闭）
   *
   *    打开它之前必须先在 Supabase 控制台完成两件事，否则一定失败：
   *      a) Authentication → Sign In / Providers → Phone  设为 Enabled；
   *      b) Authentication → Third-Auth Providers 里绑定一家短信服务商
   *         （Twilio / Vonage / 阿里云短信 等），并填好它的凭据。
   *    Supabase 自身不发短信，前端也不可能在本地验证短信验证码，
   *    所以这个开关只是「是否把手机登录表单展示出来」，
   *    真正的下发与校验由 Supabase 服务端与短信服务商完成。
   * ------------------------------------------------------------------ */
  phoneOtp: false

};
