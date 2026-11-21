/* ---------- L. 个人中心（统计 / 历史 / 详情 / 资料） ------------------- */
/**
 * 数据口径（评审一定会问，这里写清楚）：
 *   累计次数、累计字数、平均正确率 = 云端记录 + 本机尚未同步的记录，
 *     因为「我这周练了多少」不能因为网络不好就变少。
 *   连续打卡天数 = 同样合并后的本地日期集合，按用户所在时区计算，
 *     不建 SQL 函数：数据库 current_date 是 UTC，UTC+8 的用户在早上 8 点前
 *     练习会被算到前一天去，而且未登录的本机记录也要参与打卡。
 *   平均正确率优先用「首次写对的空数 / 总空数」加权，
 *     避免出现只有 2 个空的会话把平均值拉飞；
 *     还没有逐空数据的记录退回按各行 accuracy 取算术平均。
 */

/* 预设头像库：一个中文字形 + 一组渐变，纯 CSS 绘制。
   不建 Storage bucket、不上传文件，因此不存在头像泄露或审核问题。 */
const AVATARS = [
  { key: 'leaf-01',  glyph: '叶', name: '常春藤叶', bg: 'linear-gradient(140deg,#2f9e79,#1c8f6a)' },
  { key: 'lotus-02', glyph: '荷', name: '青荷',     bg: 'linear-gradient(140deg,#3fa28a,#1c5f8f)' },
  { key: 'pine-03',  glyph: '松', name: '劲松',     bg: 'linear-gradient(140deg,#2f7d5b,#0f3d33)' },
  { key: 'goose-04', glyph: '雁', name: '归雁',     bg: 'linear-gradient(140deg,#4a90b8,#1c5f8f)' },
  { key: 'lamp-05',  glyph: '灯', name: '夜读灯',   bg: 'linear-gradient(140deg,#e0a23c,#c07b1c)' },
  { key: 'book-06',  glyph: '书', name: '案头书',   bg: 'linear-gradient(140deg,#5f8fb5,#2f5f86)' }
];
function avatarOf(key) { return AVATARS.find(a => a.key === key) || AVATARS[0]; }

/* 把任意时间戳/日期字符串归一到本地 YYYY-MM-DD */
function dateOfRow(row) {
  const d = String(row.practice_date || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const ms = row.created_at ? new Date(row.created_at).getTime() : NaN;
  return isFinite(ms) ? localDateOf(ms) : '';
}

/* 连续打卡天数：从今天往前数，允许「今天还没练」从昨天起算 */
function streakFromDates(dates) {
  const set = new Set(dates.filter(Boolean));
  if (!set.size) return 0;
  const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const cur = new Date();
  const day = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
  if (!set.has(fmt(day))) {
    day.setDate(day.getDate() - 1);
    if (!set.has(fmt(day))) return 0;
  }
  let n = 0;
  while (set.has(fmt(day)) && n < 400) { n++; day.setDate(day.getDate() - 1); }
  return n;
}

const Profile = {
  cloudRows: [],
  localRows: [],
  prefs: null,
  detail: null,
  loading: false,
  signedIn: false,

  /* ---------- 页面主刷新 ---------- */
  async refresh() {
    const signedIn = !!(S.account.signedIn && Cloud.ready());
    this.signedIn = signedIn;
    // 未登录也要能看到本机统计与历史：需求里的「累计次数/字数/正确率/打卡/历史/详情/删除」
    // 在本地模式下同样成立，只是数据只存在这台浏览器，因此只有账号资料卡与云端按钮需要隐藏。
    $('pGuest').hidden = signedIn;
    $('pBody').hidden = false;
    $('pAcctCard').hidden = !signedIn;
    $('btnLogout').hidden = !signedIn;
    $('btnSyncLocal').hidden = !signedIn;
    this.localRows = History.pending();
    if (!signedIn) {
      this.cloudRows = [];
      $('pGuestMode').textContent = !AppConfig.enabled
        ? '本地模式：' + (AppConfig.reason || '未配置后端') + '，练习数据只留在本机'
        : AppConfig.tables === 'missing'
          ? '账号服务能连上，但数据表还没建（执行 sql/001_init.sql 后就能同步）；当前未登录，记录只在本机'
          : AppConfig.reach === 'down'
            ? '账号服务当前连不上（' + (AppConfig.reachMsg || '未知原因') + '）；当前未登录，记录只在本机'
            : '账号服务已配置，登录后即可同步（当前未登录）';
      this.renderStats();
      this.renderHistory();
      this.renderSyncInfo();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    const prev = $('profileState').textContent;
    $('profileState').textContent = '正在读取云端数据…';
    try {
      const p = await Cloud.loadProfile();
      this.prefs = p.ok ? (p.data.prefs || {}) : {};
      if (p.ok) {
        S.account.nickname = p.data.nickname || Auth.nickname();
        S.account.avatarKey = p.data.avatar_key || 'leaf-01';
        $('pNick').value = p.data.nickname || '';
        $('pEmail').textContent = S.account.email || '（该账号没有邮箱）';
        $('pJoined').textContent = p.data.created_at ? localDateOf(new Date(p.data.created_at).getTime()) : '未知';
        this.buildAvatarSelect();
        this.renderAvatar();
      }
      const list = await Cloud.listSessions(500);
      this.cloudRows = list.ok ? list.data : [];
      if (!list.ok) $('profileState').textContent = '云端读取失败：' + list.error;
      this.localRows = History.pending();
      this.renderStats();
      this.renderHistory();
      $('profileState').textContent = list.ok ? '数据已更新' : (prev || '');
      this.renderSyncInfo();
    } finally {
      this.loading = false;
    }
  },

  buildAvatarSelect() {
    const sel = $('pAvatar');
    if (sel.options.length === AVATARS.length) return;
    sel.innerHTML = AVATARS.map(a => '<option value="' + a.key + '">' + a.name + '</option>').join('');
    sel.value = S.account.avatarKey;
  },
  renderAvatar() {
    const a = avatarOf(S.account.avatarKey);
    const box = $('pAvatarBox');
    box.textContent = a.glyph;
    box.style.background = a.bg;
    const sel = $('pAvatar');
    if (sel.options.length) sel.value = a.key;
  },

  /* ---------- 统计 ---------- */
  renderStats() {
    const rows = this.mergedRows();
    const count = rows.length;
    const chars = rows.reduce((a, r) => a + (r.total_chars | 0), 0);
    const blankDen = rows.reduce((a, r) => a + (r.total_blanks | 0), 0);
    const blankNum = rows.reduce((a, r) => a + (r.first_try_correct | 0), 0);
    let accText = '--';
    let note = '';
    if (blankDen > 0) {
      accText = Math.round(blankNum / blankDen * 100) + '%';
      note = '平均正确率按「首次就写对的关键词空 / 全部关键词空」加权计算，共 ' + blankDen + ' 个空。';
    } else if (count) {
      const sum = rows.reduce((a, r) => a + Number(r.accuracy || 0), 0);
      accText = Math.round(sum / count) + '%';
      note = '这些记录还没有逐空明细，平均正确率暂按各行正确率的算术平均显示。';
    }
    const dates = rows.map(dateOfRow).concat(History.localDates());
    $('pStreak').textContent = streakFromDates(dates);
    $('pCount').textContent = count;
    $('pChars').textContent = chars.toLocaleString('zh-CN');
    $('pAcc').textContent = accText;
    const pending = this.localRows.length;
    $('statNote').textContent = note + (pending ? (this.signedIn
      ? ' 另有 ' + pending + ' 条记录只在本机，点下方按钮可同步到云端。'
      : ' 以上 ' + pending + ' 条记录全部只存在这台浏览器里，登录后可以同步到你自己的账号。') : '');
    const ex = [
      this.signedIn
        ? '密码由 Supabase 认证服务加密保管，本项目不读取、不保存、不上传你的密码。'
        : '当前未登录：下面的统计与历史只存在这台浏览器的本地存储里，清空浏览器数据就会丢失。',
      '你的 Hugging Face 与 Groq 密钥只存在这台浏览器的本地存储里，换设备需要重新填写，也不会同步到云端。',
      '练习记录只保存统计与关键词明细，不保存原文全文；第三方推理调用只发送需要分析的文本片段。',
      '每条数据都开启了行级安全策略，只有你自己的账号能读写；注销账号会级联删除全部记录。'
    ];
    $('pExplain').innerHTML = ex.map(t => '<li>' + escapeHtml(t) + '</li>').join('');
  },

  /** 云端行与本机待同步行统一成同一形状，供列表与统计共用 */
  mergedRows() {
    const cloud = this.cloudRows.map(r => Object.assign({}, r, { _local: false }));
    const local = this.localRows.map(r => ({
      id: r.id, _local: true, practice_date: r.localDate, created_at: new Date(r.ts).toISOString(),
      source_title: r.title, total_chars: r.totalChars, total_blanks: r.totalBlanks,
      first_try_correct: r.firstTryCorrect, accuracy: r.accuracy, duration_ms: r.durationMs,
      segment_count: r.segmentCount, segments_done: r.segmentsDone, hint_used: r.hintUsed,
      quiz_result: r.quizResult, completed: r.completed, _rec: r
    }));
    return cloud.concat(local);
  },

  quizText(v) {
    return v === 'ok' ? '闯关通过' : v === 'wrong' ? '闯关未通过' : v === 'skipped' ? '闯关已跳过' : '未遇到闯关';
  },

  /* ---------- 历史列表 ---------- */
  renderHistory() {
    const rows = this.mergedRows();
    const box = $('historyList');
    if (!rows.length) {
      box.innerHTML = '<div class="hempty">还没有练习记录。完成一次练习后，这里会出现每天的记录。</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      const acc = Math.round(Number(r.accuracy || 0)) + '%';
      const d = dateOfRow(r);
      const time = new Date(r.created_at || Date.now());
      const hhmm = String(time.getHours()).padStart(2, '0') + ':' + String(time.getMinutes()).padStart(2, '0');
      const tag = r._local ? '<span class="htag local">仅本机</span>' : '<span class="htag cloud">已同步</span>';
      const part = r.completed === false ? '<span class="htag part">中途退出</span>' : '';
      return '<div class="hitem">' +
        '<div class="hmain">' +
          '<div class="htitle">' + escapeHtml(r.source_title || '未命名练习') + '</div>' +
          '<div class="hsub">' + escapeHtml(d) + ' ' + hhmm + ' · ' +
            (r.total_chars | 0) + ' 字 · ' + (r.segments_done | 0) + '/' + (r.segment_count | 0) + ' 段 · ' +
            this.quizText(r.quiz_result) + '</div>' +
        '</div>' +
        '<span class="hnum">' + acc + '</span>' +
        '<span class="hnum">' + mmss(r.duration_ms || 0) + '</span>' +
        tag + part +
        '<button class="btn sm ghost" data-detail="' + escapeHtml(r.id) + '">详情</button>' +
      '</div>';
    }).join('');
    $$('#historyList [data-detail]').forEach(btn => {
      btn.onclick = () => this.openDetail(btn.dataset.detail);
    });
  },

  renderSyncInfo() {
    const pending = History.pending().length;
    const el = $('syncInfo');
    if (!el) return;
    if (!this.signedIn) {
      el.textContent = '未登录：记录只在本机，不会上传到任何服务器。';
      return;
    }
    el.textContent = pending
      ? '本机还有 ' + pending + ' 条记录未同步到云端。'
      : '本机记录都已同步。';
    $('btnSyncLocal').disabled = !pending;
  },

  /* ---------- 详情 ---------- */
  async openDetail(id) {
    const card = $('sessionDetail');
    card.hidden = false;
    $('detailState').textContent = '正在读取…';
    const local = this.localRows.find(r => r.id === id);
    let blanks = [], meta = '', title = '';
    if (local) {
      blanks = (local.blanks || []).map(b => ({
        segment_index: b.segmentIndex, blank_index: b.blankIndex, keyword: b.keyword,
        expected: b.expected, first_try_correct: b.firstTry, attempts: b.attempts, hint_used: b.hint
      }));
      title = local.title;
      meta = '这条记录还在本机（未同步）：' + local.localDate + ' · ' + local.totalChars + ' 字 · ' +
             (local.totalBlanks || 0) + ' 个关键词空 · 用时 ' + mmss(local.durationMs);
      $('detailState').textContent = '未同步记录：同步到云端后即可长期保存';
    } else {
      const r = await Cloud.sessionDetail(id);
      if (!r.ok) { $('detailState').textContent = r.error; return; }
      const row = r.data;
      blanks = (row.blanks || []).slice().sort((a, b) => a.segment_index - b.segment_index || a.blank_index - b.blank_index);
      title = row.source_title;
      meta = dateOfRow(row) + ' · ' + row.total_chars + ' 字 · ' + row.segment_count + ' 段 · ' +
             (row.total_blanks || 0) + ' 个关键词空 · 正确率 ' + Math.round(Number(row.accuracy)) + '% · 用时 ' + mmss(row.duration_ms) +
             ' · ' + this.quizText(row.quiz_result) + (row.completed ? '' : ' · 中途退出');
      $('detailState').textContent = '';
    }
    this.detail = { id: id, local: !!local };
    $('detailTitle').value = title || '';
    $('detailMeta').textContent = meta;
    const tbody = blanks.length ? blanks.map(b =>
      '<tr><td class="mono">' + (b.segment_index + 1) + '-' + (b.blank_index + 1) + '</td>' +
      '<td>' + escapeHtml(b.keyword) + '</td>' +
      '<td class="' + (b.first_try_correct ? 'ok' : 'bad') + '">' + (b.first_try_correct ? '首次写对' : '改过才对') + '</td>' +
      '<td class="mono">' + (b.attempts === null || b.attempts === undefined ? '未统计' : b.attempts) + '</td>' +
      '<td>' + (b.hint_used ? '用过提示' : '没用提示') + '</td></tr>'
    ).join('') : '<tr><td colspan="5" class="muted">这条记录没有逐空明细：整段默写阶段只按关键词位置判断首次是否写对，逐空尝试次数在行内挖空版本起记录。</td></tr>';
    $('detailBlanks').innerHTML =
      '<thead><tr><th>段-空</th><th>关键词</th><th>首次</th><th>尝试</th><th>提示</th></tr></thead><tbody>' + tbody + '</tbody>';
    card.scrollIntoView({ block: 'nearest' });
  },

  closeDetail() { $('sessionDetail').hidden = true; this.detail = null; },

  async renameDetail() {
    if (!this.detail) return;
    const clean = $('detailTitle').value.trim().slice(0, 120);
    if (!clean) { $('detailState').textContent = '名称不能为空'; return; }
    if (this.detail.local) {
      const list = Store.history();
      const hit = list.find(r => r.id === this.detail.id);
      if (!hit) { $('detailState').textContent = '这条本机记录已不存在'; return; }
      hit.title = clean;
      Store.saveHistory(list);
      this.localRows = History.pending();
      $('detailState').textContent = '已改名为本机记录，同步到云端时会带上新名称';
      this.renderHistory();
      this.renderStats();
      return;
    }
    const r = await Cloud.renameSession(this.detail.id, clean);
    $('detailState').textContent = r.ok ? '已更新名称' : r.error;
    if (r.ok) {
      const hit = this.cloudRows.find(x => x.id === this.detail.id);
      if (hit) hit.source_title = r.title;
      this.renderHistory();
    }
  },

  async deleteDetail() {
    if (!this.detail) return;
    const row = this.cloudRows.find(x => x.id === this.detail.id) || this.localRows.find(r => r.id === this.detail.id) || {};
    const name = row.source_title || row.title || '';
    if (this.detail.local) {
      if (!confirm('删除这条只存在本机的记录吗？\n\n' + name)) return;
      const kept = Store.history().filter(r => r.id !== this.detail.id);
      Store.saveHistory(kept);
      this.localRows = History.pending();
      this.closeDetail();
      this.renderStats();
      this.renderHistory();
      this.renderSyncInfo();
      toast('已删除本机记录');
      return;
    }
    if (!confirm('删除这条练习记录吗？它的逐空明细会一起删除，且无法恢复。\n\n' + name)) return;
    const r = await Cloud.deleteSession(this.detail.id);
    if (!r.ok) { $('detailState').textContent = r.error; return; }
    this.cloudRows = this.cloudRows.filter(x => x.id !== this.detail.id);
    $('detailState').textContent = '已删除';
    this.closeDetail();
    this.renderStats();
    this.renderHistory();
    toast('记录已删除');
  },

  /* ---------- 资料保存 ---------- */
  async saveProfile() {
    $('profileState').textContent = '保存中…';
    const r = await Cloud.saveProfile({
      nickname: $('pNick').value.trim() || '记忆练习者',
      avatar_key: $('pAvatar').value
    });
    if (r.ok) {
      S.account.nickname = r.data.nickname;
      S.account.avatarKey = r.data.avatar_key;
      this.renderAvatar();
      $('profileState').textContent = '资料已保存';
    } else {
      $('profileState').textContent = '保存失败：' + r.error;
    }
  },

  /* ---------- 同步本机记录 ---------- */
  async syncNow(viaSheet) {
    const pending = History.pending().length;
    if (!pending) { toast('本机没有待同步的记录'); this.renderSyncInfo(); return; }
    $('migrateState').hidden = false;
    $('migrateState').className = 'tip info';
    $('migrateState').textContent = '正在同步 0 / ' + pending + ' 条…';
    const r = await Cloud.migratePending((done, total, err) => {
      $('migrateState').textContent = '已同步 ' + done + ' / ' + total + ' 条' + (err ? '：' + err : '');
    });
    if (!r.ok && r.error && !r.done) {
      $('migrateState').className = 'tip warn';
      $('migrateState').textContent = '同步没有成功：' + r.error;
      toast('同步失败，记录仍在本机', 'warn');
    } else {
      toast(r.failed ? ('已同步 ' + r.done + ' 条，' + r.failed + ' 条失败并保留在本机') : ('本机记录已全部同步（' + r.done + ' 条）'));
      if (!viaSheet) this.closeSheet();
      await this.refresh();
    }
    return r;
  },

  openSheet() {
    const pending = History.pending().length;
    if (!pending) return false;
    $('migrateDesc').textContent =
      '检测到这台设备上有 ' + pending + ' 条练习记录还没有同步到你的账号。' +
      '需要说明的是：更早的版本没有保存任何练习历史，所以这里通常只会包含你从今天开始的记录。';
    $('migrateState').hidden = true;
    $('migrateVeil').classList.add('on');
    $('btnMigrateYes').focus();
    return true;
  },
  closeSheet() { $('migrateVeil').classList.remove('on'); }
};
