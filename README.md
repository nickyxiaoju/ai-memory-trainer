# AI 沉浸式记忆练习助手

阿里云天池 AI 算法大赛参赛作品。把任何一段文字（拍照识别的、粘贴进来的）自动变成「逐空默写」训练：
系统挑出关键词挖成空位，原文照常显示，用户只在空位里填写，每个空独立实时判定对错，
中途插入闯关测验，结束后给出按空统计的正确率报告。

线上地址：<https://ai-memory-trainer-xrgk9rhntt7.qoder.zone/>

纯前端实现，没有自建服务端：整个产品就是 `web/` 目录下的静态文件，可以直接部署到任何静态托管。

## 项目简介

| 项 | 说明 |
| --- | --- |
| 目标用户 | 需要背诵文本的学生、备考人群，以及做脑力训练的长辈 |
| 核心链路 | 取文（拍照 OCR / 粘贴）→ 智能分段 → AI 挑关键词挖空 → 行内逐空默写 → 50% 处闯关测验 → 练习报告 |
| 判定方式 | 每个空位独立状态机（`empty` / `ok` / `bad`），过段条件只看空位本身，不依赖全局长度对齐 |
| 提示机制 | 每段 3 次提示预算，按前缀逐字展开（首字 → 前两字），用过提示的空不再计入「首次正确」 |
| 无障碍 | 大字模式、自动朗读、键盘全程可达（Tab 按文序走空、Enter 前进、Shift+Enter 后退）、模态焦点圈闭、`aria-live` 播报 |
| 降级保证 | 未取得大模型结果时退回本地关键词与本地出题，演示不会被外部服务阻断 |

界面文案全部中文，不使用任何表情符号。

## 技术栈

- **前端**：原生 HTML + CSS + JavaScript，零构建、零框架。全部脚本以传统 `<script>` 顺序加载（非 ES Module），
  顶层 `const`/`let` 为词法全局，页面里直接可读，便于在浏览器控制台逐项验收。
- **账号与数据**：Supabase（GoTrue 邮箱密码注册登录 + PostgREST + RLS）。
  客户端 SDK 是 `@supabase/supabase-js` v2 的 UMD 版本，本地化在 `web/vendor/supabase.js`，
  暴露全局 `supabase`；不依赖 CDN，断网或 CDN 不可达时页面照常启动。
- **OCR**：Hugging Face 推理接口，两种引擎可选。
  默认「多模态大模型」走 `api-inference.huggingface.co/models/<model>/v1/chat/completions`，
  模型 ID 默认 `Qwen/Qwen2.5-VL-7B-Instruct`；另一路「文档解析模型」（TrOCR / DocTR 等）走图片端点。
- **文本理解与出题**：Groq 的 OpenAI 兼容端点 `api.groq.com/openai/v1/chat/completions`，
  默认模型 `llama-3.3-70b-versatile`，可选 `llama-3.1-8b-instant`、`gemma2-9b-it`。
  外部调用失败即退回本地算法（`js/keywords.js` 的 `localKeywords`、`js/quiz.js` 的 `localQuiz`）。
- **字体**：霞鹜文楷（见「字体与许可致谢」）。
- **本地存储**：`localStorage`（配置、第三方密钥、练习历史、同步提示标记），按账号 uid 命名空间隔离。
- **发布**：Qoder Sites 静态托管（Aliyun OSS）。打包规则是「整个 `web/` 目录，没有排除清单」，
  所以任何机密文件都必须在 `web/` 之外。

脚本加载顺序即依赖顺序，改动时请保持：

```
vendor/supabase.js → js/config.js → core → store → api → text → keywords
→ quiz → practice → report → auth → cloud → history → profile → app
```

## 目录结构

```
.
├── .gitignore
├── README.md
└── web/                        发布目录 = 产品目录，原地即产物
    ├── index.html              DOM 骨架 + 各脚本引用
    ├── css/
    │   ├── app.css             全局变量、顶栏、控件、弹层
    │   ├── landing.css         首页首屏、分屏吸附、右侧圆点指示器
    │   └── textbook.css        课本页、圆角标签页、便签折叠、行内空位
    ├── js/
    │   ├── core.js             小工具与全局状态 S、屏幕导航 go()、后端配置读取 AppConfig
    │   ├── store.js            localStorage 层：配置 / 密钥 / 历史 / 命名空间
    │   ├── api.js              带超时的 fetch、OCR 取文与展平、Groq JSON 调用、报错中文化
    │   ├── text.js             文本规范化（NBSP / 全角 / 零宽）与智能分段
    │   ├── keywords.js         关键词挑选：本地兜底 + AI 挑选
    │   ├── quiz.js             闯关测验：本地出题 + AI 出题 + 填空判定
    │   ├── practice.js         行内挖空默写页：空位状态机、提示、过段
    │   ├── report.js           开始练习、结束报告、按空统计指标
    │   ├── auth.js             Supabase 注册 / 登录 / 找回密码 / 会话恢复 / 退出
    │   ├── cloud.js            profiles / sessions / blanks 读写与本地记录迁移
    │   ├── history.js          本机练习历史写入（上限 200 条，不存全文）
    │   ├── profile.js          个人中心：统计、历史列表、单次详情、改名与删除
    │   ├── app.js              启动编排与全站事件绑定、首页分屏与圆点
    │   ├── config.example.js   配置模板（入库，全空值 + 注释）
    │   └── config.js           真实配置：不入库、不在发布目录，见下节
    └── vendor/
        └── supabase.js         @supabase/supabase-js v2 UMD 本地副本
```

仓库里**不包含**以下内容，均由 `.gitignore` 排除，原因是发布与入库约定要求机密与本机调试产物不得进入代码仓库：

- `web/js/config.js` —— 真实 Supabase 项目地址与前端公钥；
- `_local/` —— 上面那个文件的实际存放位置（在 `web/` 之外，保证不会被打包）；
- `sql/` —— 只在 Supabase 控制台执行的建表与授权脚本，含库结构细节，不随仓库分发；
- `shots/` —— 无头浏览器截图脚本与截图产物；
- `_source_reference/` —— 拆分前的旧单文件基线，仅供对照；
- `*.qoder.site` —— 托管平台的绑定文件。

需要自行部署云端功能时，按 `js/cloud.js` 与 `js/auth.js` 里出现的表名和列名建立等价结构即可：
`profiles`（`id` / `nickname` / `avatar_key` / `prefs`）、
`sessions`（练习记录，含 `user_id`、`client_id` 去重键与按空统计的各项指标）、
`blanks`（逐空明细，`session_id` + `segment_index` + `blank_index` 唯一），
三张表都要启用 RLS 并只允许 `auth.uid()` 匹配自己那行，同时别忘了给 `anon` / `authenticated` 角色显式授权
（在 Supabase 控制台用 SQL 建的表不会自动拿到权限）。

## 本地运行方式

必须用 HTTP 打开，不能直接双击 `web/index.html`：`file://` 下 Supabase 的会话与重定向、
`crypto.randomUUID` 都不可用，登录与历史记录会失准。

```bash
# 在项目根目录执行（任选一种）
python -m http.server 5173 -d web
# 或 Windows 上
py -m http.server 5173 -d web
```

然后访问 <http://127.0.0.1:5173/>。

首次使用想立刻看到效果，不必配置任何密钥：点首页的「演示模式体验（无需 API Key）」，
用内置示例文本走完整链路（分段 → 挖空 → 默写 → 报告）。

要接自己的 OCR 与大模型，在「准备页」的密钥区填 Hugging Face Token 与 Groq API Key。
这两把密钥**只写进当前浏览器的 `localStorage`**，代码仓库里永远不出现；
勾选「记住密钥」才会留存，取消勾选会连存储一起清掉。在公用电脑上请勿勾选。

要启用账号与云端记录：

```bash
cp web/js/config.example.js web/js/config.js
# 编辑 web/js/config.js，填入 Project URL 与 anon key
```

填完刷新页面即进入账号模式。**每次发布前必须把 `web/js/config.js` 移出 `web/`**
（例如放到 `_local/js/config.js`），否则平台会把真实密钥一起打包上线。

## 字体与许可致谢

正文使用**霞鹜文楷 LXGW WenKai**，许可证 **SIL Open Font License 1.1**，
免费商用、无需署名、允许嵌入网页。通过 jsDelivr 的 `lxgw-wenkai-webfont@1.7.0` 引入，
该包按 `unicode-range` 切成多个 woff2 分片，只下载页面实际用到的字形（完整 TTF 达 19–21 MB，不可用于网页）。

加载方式刻意做成不阻塞首屏：`media="print"` 先挂上、`onload` 再切回 `all`，并配 `<noscript>` 兜底；
同时用 `document.fonts.load('1em "LXGW WenKai"')` 与 3 秒超时赛跑，取不到字体就给 `<html>` 加 `.no-hand`，
退回系统楷体再到系统黑体。**字体只影响字形观感，不影响任何功能**；
便签里的「字体风格」开关可在手写体与清晰黑体之间切换。

其他第三方组件许可：`@supabase/supabase-js`（MIT，本地副本见 `web/vendor/supabase.js`）。
Hugging Face 与 Groq 只是被调用的推理服务，本项目不分发它们的任何代码或凭据。
示例文本中的《岳阳楼记》为公版古籍。

## 本地模式与账号模式说明

页面启动时读取 `window.APP_CONFIG`，据此决定运行在哪种模式，并且会把当前状态如实显示在顶栏与个人中心。

| 状态 | 触发条件 | 表现 |
| --- | --- | --- |
| 本地模式 | `config.js` 缺失，或其中项目地址 / 前端公钥为空，或 SDK 未加载 | 顶栏显示「本地模式」；不发起任何云端请求；全部核心算法照常工作 |
| 账号模式（已连接） | 配置有效且后端可达 | 可注册登录；练习记录同步到自己的 Supabase 账号；设置项按账号合并 |
| 账号模式（后端异常） | 配置写了但连不上，或数据表缺失 / 未授权 | 页面自行诊断并说明具体原因（域名解析不到、请求超时、数据表还没建等），不会假装已同步 |

判定逻辑在 `js/core.js` 的 `AppConfig`，其中 `check()` 是一次只读旁路探测，
只用来让文案说得更准确，**不改变任何功能是否可用**；`js/config.js` 不存在时它只会把开关关掉，不抛错。

两种模式的实质差别只有一件事：**练习记录存在哪里**。

- 本地模式：记录只写进当前浏览器的 `localStorage`（键名 `memtrainer_history`，按 uid 命名，上限 200 条，
  不保存全文）。清掉浏览器数据或换设备/换浏览器，历史就没了。
- 账号模式：先写本机、再同步云端（离线优先）。云端写入失败只弹提示，**绝不回滚本地记录、绝不把用户卡在加载遮罩里**。
  未登录时产生的记录会在登录时并入本人账号，靠 `client_id` 与唯一索引防止重复计数。

无论哪种模式，以下边界始终成立：

- 密码只交给 Supabase Auth 处理，**不写进任何数据表、`localStorage` 或日志**；
- 前端只使用 anon key（受限公钥），**不使用 `service_role`**，本项目不存在任何服务端密钥；
- 数据表启用 RLS，每个账号只能读写自己的行，未登录读不到任何数据；
- 注册走邮箱 + 密码。忘记密码调用真实的 `resetPasswordForEmail`，
  但演示环境未配置自定义 SMTP 时可能收不到邮件，界面同时给出「联系管理员后台重置」的兜底说明；
  邮件里的重置链接需要在**发起重置的同一浏览器**打开，换设备会导致 PKCE 状态校验失败；
- 手机号验证码登录是默认关闭的配置开关（`phoneOtp: false`）。它只决定「是否展示手机登录表单」，
  真正下发与校验短信必须由 Supabase 启用 Phone provider 并绑定短信服务商才能完成
  —— Supabase 自身不发短信，前端更不可能在本地验证短信验证码；
- 调用第三方推理时只发送待分析的文本片段；未登录时的全部处理都在本机浏览器内完成。

线上发布的版本目前是**本地模式**：发布包里不含 `config.js`，因此没有注册入口与云端同步，
评委看到的是完整的算法演示与本机历史记录，不带有账号系统。这一事实不应被描述成「账号功能已上线」。

## 已知限制

- 线上包未接入云端，账号与同步行为在发布环境中不生效（原因见上节）。
- 忘记密码依赖 Supabase 的默认发信通道，未配置自有 SMTP 时送达率与发件域名都受限制。
- 静态托管没有 SPA 路径重写，所有路由都在单页内完成；新增的 js / css 文件必须真实存在，否则 404。
- 预览地址与正式发布地址属于不同源，两者的 `localStorage` 历史记录互不相通。
- 仓库未包含图标文件，线上页面会额外产生一次 `favicon.ico` 的 404，仅影响控制台观感。
