/* ---------- K. 云端数据层（Supabase PostgREST） ------------------------ */
/**
 * 所有云请求的唯一出口。三条铁律：
 * 1. 未登录或后端未配置时直接返回 skipped，一个请求都不发。
 *    anon 角色在三张表上没有任何 RLS 策略，发出去只会得到 401 噪音。
 * 2. 云写入永远在 hideVeil() 之后、且在本地写入之后进行。
 *    网络失败只提示，绝不回滚本机数据，也绝不把用户锁在遮罩里。
 * 3. 只用 anon key + RLS。这里不出现任何能绕过策略的服务端密钥。
 */
const Cloud = {
  client: null,
  BATCH: 200,

  init() { this.client = Auth.client || null; },

  /** 是否具备发请求的条件 */
  ready() { return !!(this.client && S.account.signedIn && S.account.userId); },
  skipped(msg) { return { ok: false, skipped: true, error: msg || '未登录或后端未配置，数据只保存在本机' }; },
  uid() { return S.account.userId; },

  /** PostgREST / RLS 错误 -> 中文 */
  msg(e) {
    if (!e) return '未知错误';
    const m = String(e.message || e.details || e.code || e);
    const low = m.toLowerCase();
    if (/row-level security/.test(low)) return '没有权限写入这条数据（登录状态可能已过期），请重新登录';
    if (/duplicate key value/.test(low)) return '这条记录已经同步过了，已按成功处理';
    if (/relation .* does not exist/.test(low) || /schema .* not found/.test(low) ||
        /pgrst205/.test(low) || /could not find the table/.test(low)) return
      '数据表还没有建好：请在 Supabase 控制台的 SQL Editor 里执行 sql/001_init.sql；' +
      '如果已经执行过，请到 Settings → API 重启一次接口让缓存刷新。本次记录仍然保存在本机。';
    if (/could not find the relationship/.test(low)) return '数据库外键关系与预期不一致，请检查建表脚本';
    if (/user from sub claim|invalid user|user not found/.test(low)) return '这个账号在服务器上已经不存在（可能被删除或注销），请重新登录；记录仍保存在本机';
    if (/invalid claim|jwt expired|token/.test(low)) return '登录凭证已过期，请重新登录';
    if (/network|failed to fetch/.test(low)) return '连不上数据服务，请检查网络；本次记录仍保存在本机';
    return m.slice(0, 160);
  },

  /** 唯一索引冲突（迁移重放）不算失败 */
  isDuplicate(e) { return !!e && (e.code === '23505' || /duplicate key/i.test(String(e.message || ''))); },

  /* ---------- 写：一次练习 ---------- */

  sessionRow(rec) {
    return {
      user_id: this.uid(),
      practice_date: rec.localDate,
      source_title: String(rec.title || '未命名练习').slice(0, 120),
      total_chars: rec.totalChars | 0,
      segment_count: rec.segmentCount | 0,
      segments_done: rec.segmentsDone | 0,
      total_blanks: rec.totalBlanks | 0,
      first_try_correct: rec.firstTryCorrect | 0,
      accuracy: rec.accuracy | 0,
      duration_ms: rec.durationMs | 0,
      hint_used: rec.hintUsed | 0,
      quiz_passed: rec.quizResult === 'ok',
      quiz_result: ['none', 'ok', 'wrong', 'skipped'].includes(rec.quizResult) ? rec.quizResult : 'none',
      completed: !!rec.completed,
      client_id: rec.id,
      source_kind: rec.sourceKind || 'client'
    };
  },

  blankRows(sessionId, rec) {
    return (rec.blanks || []).map(b => ({
      session_id: sessionId,
      user_id: this.uid(),
      segment_index: b.segmentIndex | 0,
      blank_index: b.blankIndex | 0,
      keyword: String(b.keyword).slice(0, 80),
      expected: String(b.expected).slice(0, 80),
      char_start: b.charStart | 0,
      char_end: b.charEnd | 0,
      attempts: Math.max(1, Math.min(200, b.attempts | 0)),   // 库约束 1..200：空着没填也记 1 次未答对
      first_try_correct: !!b.firstTry,
      hint_used: !!b.hint,
      final_text: b.finalText ? String(b.finalText).slice(0, 80) : null
    }));
  },

  /** 分批写逐空明细；重复行按成功处理，其它错误返回失败让记录留在待同步队列 */
  async writeBlanks(sessionId, rec) {
    let ok = true, error = '';
    const rows = this.blankRows(sessionId, rec);
    for (let i = 0; i < rows.length; i += this.BATCH) {
      const part = rows.slice(i, i + this.BATCH);
      const r = await this.client.from('blanks').insert(part);
      if (r.error && !this.isDuplicate(r.error)) { ok = false; error = this.msg(r.error); break; }
    }
    return { ok: ok, error: error };
  },

  /**
   * 上传一条练习记录：先写 sessions 拿回 id，再分批写 blanks。
   * 只有 sessions 与 blanks 都成功才标记 synced；否则记录留在本机，
   * 下次同步会走去重分支，把缺失的逐空明细补齐（重复行由唯一索引挡掉）。
   */
  async saveSession(rec) {
    if (!this.ready()) return this.skipped();
    try {
      const { data, error } = await this.client.from('sessions')
        .insert(this.sessionRow(rec)).select('id').single();
      if (error) {
        if (this.isDuplicate(error)) {
          const found = await this.client.from('sessions')
            .select('id').eq('client_id', rec.id).maybeSingle();
          if (found.error) return { ok: false, error: this.msg(found.error) };
          if (!found.data) return { ok: false, error: this.msg(error) };
          const b = await this.writeBlanks(found.data.id, rec);
          if (!b.ok) return { ok: false, cloudId: found.data.id, deduped: true, error: b.error };
          History.markSynced(rec.id, found.data.id);
          return { ok: true, cloudId: found.data.id, deduped: true };
        }
        return { ok: false, error: this.msg(error) };
      }
      const sessionId = data.id;
      const b = await this.writeBlanks(sessionId, rec);
      if (!b.ok) return { ok: false, cloudId: sessionId, error: b.error };
      History.markSynced(rec.id, sessionId);
      return { ok: true, cloudId: sessionId };
    } catch (e) {
      return { ok: false, error: this.msg(e) };
    }
  },

  /* ---------- 读：历史与详情 ---------- */

  async listSessions(limit) {
    if (!this.ready()) return this.skipped();
    const { data, error } = await this.client.from('sessions')
      .select('*')
      .eq('user_id', this.uid())
      .order('created_at', { ascending: false })
      .limit(limit || 500);
    if (error) return { ok: false, error: this.msg(error) };
    return { ok: true, data: data || [] };
  },

  async sessionDetail(id) {
    if (!this.ready()) return this.skipped();
    const { data, error } = await this.client.from('sessions')
      .select('*, blanks(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) return { ok: false, error: this.msg(error) };
    if (!data) return { ok: false, error: '找不到这条记录，或它不属于当前账号' };
    return { ok: true, data: data };
  },

  async renameSession(id, title) {
    if (!this.ready()) return this.skipped();
    const clean = String(title || '').trim().slice(0, 120);
    if (!clean) return { ok: false, error: '名称不能为空' };
    const { error } = await this.client.from('sessions')
      .update({ source_title: clean }).eq('id', id).eq('user_id', this.uid());
    if (error) return { ok: false, error: this.msg(error) };
    return { ok: true, title: clean };
  },

  /** 删除 sessions 一行，数据库会级联删掉它的 blanks（见 on delete cascade） */
  async deleteSession(id) {
    if (!this.ready()) return this.skipped();
    const { error } = await this.client.from('sessions')
      .delete().eq('id', id).eq('user_id', this.uid());
    if (error) return { ok: false, error: this.msg(error) };
    return { ok: true };
  },

  /* ---------- 资料与偏好（不含任何密钥） ---------- */

  /** 老账号或手工建的账号可能没有 profile 行，这里补一条再返回 */
  async loadProfile() {
    if (!this.ready()) return this.skipped();
    let { data, error } = await this.client.from('profiles')
      .select('*').eq('id', this.uid()).maybeSingle();
    if (error) return { ok: false, error: this.msg(error) };
    if (!data) {
      const ins = await this.client.from('profiles').insert({
        id: this.uid(),
        nickname: Auth.nickname(),
        prefs: Store.collectPrefs()
      }).select('*').single();
      if (ins.error) return { ok: false, error: this.msg(ins.error) };
      data = ins.data;
    }
    return { ok: true, data: data };
  },

  async saveProfile(patch) {
    if (!this.ready()) return this.skipped();
    const row = { id: this.uid() };
    if (patch.nickname !== undefined) row.nickname = String(patch.nickname).trim().slice(0, 24) || '记忆练习者';
    if (patch.avatar_key !== undefined) row.avatar_key = String(patch.avatar_key).slice(0, 32);
    if (patch.prefs !== undefined) row.prefs = patch.prefs;
    const { data, error } = await this.client.from('profiles')
      .upsert(row, { onConflict: 'id' }).select('*').single();
    if (error) return { ok: false, error: this.msg(error) };
    return { ok: true, data: data };
  },

  /** 只同步非密钥偏好；HF/Groq 密钥永远留在本机 */
  syncPrefs() {
    return this.ready() ? this.saveProfile({ prefs: Store.collectPrefs() }) : this.skipped();
  },

  /* ---------- 本机 -> 云端批量迁移 ---------- */

  migrating: false,

  /**
   * 把 synced:false 的本机记录逐条上传。分批、可中断、连点有闩锁。
   * onProgress(done, total, currentError) 由 UI 用来更新进度文案。
   */
  async migratePending(onProgress) {
    if (!this.ready()) return this.skipped();
    if (this.migrating) return { ok: false, error: '同步正在进行中，请稍候' };
    this.migrating = true;
    let done = 0, failed = 0, lastError = '';
    try {
      const queue = History.pending();
      for (let i = 0; i < queue.length; i++) {
        if (onProgress) onProgress(i, queue.length, '');
        const rec = Object.assign({}, queue[i], { sourceKind: 'migration' });
        const r = await this.saveSession(rec);
        if (r.ok) done++; else { failed++; lastError = r.error; }
      }
      if (onProgress) onProgress(queue.length - failed, queue.length, lastError);
      if (done) Store.write(Store.key(Store.BASE_PROMPT), true);
      return { ok: failed === 0, done: done, failed: failed, total: queue.length, error: lastError };
    } catch (e) {
      return { ok: false, done: done, failed: failed, error: this.msg(e) };
    } finally {
      this.migrating = false;
    }
  }
};
