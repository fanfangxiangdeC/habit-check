/* ===== 习惯打卡 · 页面逻辑（v2：登录 + 同步队列修复快速连点） ===== */
(() => {
  'use strict';

  const cfg = window.HABIT_CONFIG || {};
  const supabaseUrl = cfg.supabaseUrl || '';
  const supabaseAnonKey = cfg.supabaseAnonKey || '';
  const configured =
    supabaseUrl && !supabaseUrl.startsWith('PASTE_') &&
    supabaseAnonKey && !supabaseAnonKey.startsWith('PASTE_');

  let supabase = null;
  if (configured && window.supabase) {
    supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }

  const EMOJI_PRESETS = ['💧', '🏃', '📚', '🧘', '🥗', '💪', '😴', '🎯', '🚶', '🦷'];

  // ---------- 状态 ----------
  let habits = [];                       // [{id, name, emoji, created_at}]
  let checkins = new Map();              // habit_id -> Set('YYYY-MM-DD')
  let todayKey = fmtDate(new Date());
  let currentUser = null;                // {id, email}
  let loadEpoch = 0;                     // 拉取纪元：本地有改动就作废在途请求
  const syncQueues = new Map();          // habit_id -> Promise 链
  const pendingSync = new Set();         // 正在同步的习惯
  let authMode = 'login';                // login | register | reset
  let authSubmitted = false;
  let realtimeReady = false;
  let midnightTimer = null;

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const elDate = $('#dateLabel');
  const elList = $('#habitList');
  const elEmpty = $('#emptyState');
  const elProgressText = $('#progressText');
  const elProgressPct = $('#progressPct');
  const elProgressFill = $('#progressFill');
  const elConfigBanner = $('#configBanner');
  const elModal = $('#modalOverlay');
  const elInputName = $('#inputName');
  const elInputEmoji = $('#inputEmoji');
  const elEmojiPicker = $('#emojiPicker');
  const elToast = $('#toast');

  const elAuthView = $('#authView');
  const elAppView = $('#appView');
  const elAuthSub = $('#authSub');
  const elAuthEmail = $('#authEmail');
  const elAuthPassword = $('#authPassword');
  const elAuthPasswordLabel = $('#authPasswordLabel');
  const elAuthError = $('#authError');
  const elAuthSubmit = $('#authSubmit');
  const elAuthLinks = $('#authLinks');
  const elAuthToggle = $('#authToggle');
  const elAuthForgot = $('#authForgot');
  const elAccountEmail = $('#accountEmail');

  // ---------- 工具 ----------
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateLabelText() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
  }

  function last7Days() {
    const keys = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) { keys.push(fmtDate(d)); d.setDate(d.getDate() + 1); }
    return keys;
  }

  function calcStreak(id, doneSet) {
    let streak = 0;
    const d = new Date();
    if (!doneSet.has(fmtDate(d))) d.setDate(d.getDate() - 1); // 今天还没勾不算断签
    while (doneSet.has(fmtDate(d))) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  let toastTimer = null;
  function showToast(msg) {
    elToast.textContent = msg;
    elToast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.add('hidden'), 2600);
  }

  function invalidateLoads() { loadEpoch++; }

  // ---------- 渲染 ----------
  function render() {
    elDate.textContent = dateLabelText();

    const done = habits.filter((h) => (checkins.get(h.id) || new Set()).has(todayKey)).length;
    const total = habits.length;
    elProgressText.textContent = `今天完成 ${done} / ${total}`;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    elProgressPct.textContent = total === 0 ? '' : `${pct}%`;
    elProgressFill.style.width = `${pct}%`;
    elProgressFill.classList.toggle('full', total > 0 && done === total);

    elEmpty.classList.toggle('hidden', habits.length > 0);

    elList.innerHTML = '';
    for (const h of habits) elList.appendChild(renderCard(h));
  }

  function renderCard(h) {
    const li = document.createElement('li');
    li.className = 'habit-card';
    li.dataset.id = h.id;

    const doneSet = checkins.get(h.id) || new Set();
    const checked = doneSet.has(todayKey);
    const streak = calcStreak(h.id, doneSet);
    const dots = last7Days()
      .map((k) => `<i class="dot${doneSet.has(k) ? ' on' : ''}"></i>`)
      .join('');

    li.innerHTML = `
      <div class="habit-emoji">${escapeHtml(h.emoji || '📌')}</div>
      <div class="habit-info">
        <div class="habit-name" title="点击重命名">${escapeHtml(h.name)}</div>
        <div class="habit-meta">
          <span class="streak">🔥 ${streak} 天</span>
          <span class="dots">${dots}</span>
        </div>
      </div>
      <button class="check-btn${checked ? ' checked' : ''}" aria-label="${checked ? '取消完成' : '标记完成'}">${checked ? '✓' : ''}</button>
      <button class="menu-btn" aria-label="更多操作">⋯</button>
      <div class="menu hidden">
        <button class="menu-item" data-action="rename">重命名</button>
        <button class="menu-item danger" data-action="delete">删除</button>
      </div>
    `;

    li.querySelector('.check-btn').addEventListener('click', () => toggleCheck(h.id));

    const menuBtn = li.querySelector('.menu-btn');
    const menu = li.querySelector('.menu');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllMenus();
      menu.classList.toggle('hidden');
    });
    menu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'rename') startRename(li, h);
      if (action === 'delete') deleteHabit(h.id);
      closeAllMenus();
    });

    return li;
  }

  function closeAllMenus() {
    document.querySelectorAll('.menu:not(.hidden)').forEach((m) => m.classList.add('hidden'));
  }

  // ---------- 数据加载（带纪元保护，丢弃过期请求） ----------
  async function loadData() {
    if (!supabase || !currentUser) return;
    const epoch = ++loadEpoch;
    try {
      const [hRes, cRes] = await Promise.all([
        supabase.from('habits').select('*').order('created_at', { ascending: true }),
        supabase.from('checkins').select('*'),
      ]);
      if (hRes.error) throw hRes.error;
      if (cRes.error) throw cRes.error;
      if (epoch !== loadEpoch) return; // 已过期，丢弃，避免覆盖新状态
      habits = hRes.data || [];
      checkins = new Map();
      for (const row of cRes.data || []) {
        if (!checkins.has(row.habit_id)) checkins.set(row.habit_id, new Set());
        checkins.get(row.habit_id).add(row.date);
      }
      render();
    } catch (err) {
      if (epoch === loadEpoch) showToast('加载数据失败：' + err.message);
    }
  }

  // ---------- 勾选/取消（每个习惯一条队列，幂等收敛，修复快速连点） ----------
  function toggleCheck(habitId) {
    if (!supabase || !currentUser) return;
    invalidateLoads();
    let s = checkins.get(habitId);
    if (!s) { s = new Set(); checkins.set(habitId, s); }
    if (s.has(todayKey)) s.delete(todayKey); else s.add(todayKey);
    render();
    enqueueSync(habitId);
  }

  function enqueueSync(habitId) {
    const prev = syncQueues.get(habitId) || Promise.resolve();
    const next = prev.then(() => syncToServer(habitId));
    // 队列吞掉错误，保证后续任务继续执行
    syncQueues.set(habitId, next.catch(() => {}));
  }

  async function syncToServer(habitId) {
    if (!supabase || !currentUser) return;
    pendingSync.add(habitId);
    try {
      const s = checkins.get(habitId);
      const checked = !!s && s.has(todayKey);
      if (checked) {
        const { error } = await supabase.from('checkins')
          .upsert({ habit_id: habitId, date: todayKey }, { onConflict: 'habit_id,date', ignoreDuplicates: true });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('checkins')
          .delete().eq('habit_id', habitId).eq('date', todayKey);
        if (error) throw error;
      }
    } catch (err) {
      showToast('同步失败：' + err.message);
    } finally {
      pendingSync.delete(habitId);
      loadData(); // 以服务器为准重新拉取（新纪元，丢弃旧的过期请求）
    }
  }

  // ---------- 添加 / 重命名 / 删除 ----------
  async function addHabit(name, emoji) {
    const { data, error } = await supabase.from('habits')
      .insert({ name, emoji: emoji || '📌' }).select().single();
    if (error) throw error;
    invalidateLoads();
    habits.push(data);
    render();
  }

  async function renameHabit(id, name) {
    const { error } = await supabase.from('habits').update({ name }).eq('id', id);
    if (error) throw error;
    invalidateLoads();
    const h = habits.find((x) => x.id === id);
    if (h) h.name = name;
    render();
  }

  async function deleteHabit(id) {
    if (!confirm('确定删除这个习惯吗？它的打卡记录也会一起删除。')) return;
    try {
      const { error } = await supabase.from('habits').delete().eq('id', id);
      if (error) throw error;
      invalidateLoads();
      habits = habits.filter((x) => x.id !== id);
      checkins.delete(id);
      render();
    } catch (err) {
      showToast('删除失败：' + err.message);
    }
  }

  function startRename(li, h) {
    const nameEl = li.querySelector('.habit-name');
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = h.name;
    input.maxLength = 20;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (val && val !== h.name) {
        try { await renameHabit(h.id, val); }
        catch (err) { showToast('重命名失败：' + err.message); render(); }
      } else {
        render();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { done = true; render(); }
    });
    input.addEventListener('blur', commit);
  }

  // ---------- 弹窗 ----------
  function buildEmojiPicker() {
    elEmojiPicker.innerHTML = '';
    EMOJI_PRESETS.forEach((em) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-chip';
      btn.textContent = em;
      btn.addEventListener('click', () => {
        elInputEmoji.value = em;
        elEmojiPicker.querySelectorAll('.emoji-chip').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      elEmojiPicker.appendChild(btn);
    });
    elInputEmoji.addEventListener('input', () => {
      elEmojiPicker.querySelectorAll('.emoji-chip').forEach((b) =>
        b.classList.toggle('selected', b.textContent === elInputEmoji.value.trim()));
    });
  }

  function openModal() {
    elInputName.value = '';
    elInputEmoji.value = '📌';
    elEmojiPicker.querySelectorAll('.emoji-chip').forEach((b) =>
      b.classList.toggle('selected', b.textContent === '📌'));
    elModal.classList.remove('hidden');
    elInputName.focus();
  }

  function closeModal() { elModal.classList.add('hidden'); }

  async function onSave() {
    const name = elInputName.value.trim();
    if (!name) { showToast('请输入习惯名称'); return; }
    const emoji = elInputEmoji.value.trim() || '📌';
    try {
      await addHabit(name, emoji);
      closeModal();
    } catch (err) {
      showToast('添加失败：' + err.message);
    }
  }

  // ---------- 登录 / 注册 / 重置密码 ----------
  function showAuthError(msg) {
    elAuthError.textContent = msg;
    elAuthError.classList.remove('hidden');
  }
  function hideAuthError() { elAuthError.classList.add('hidden'); }

  function setAuthMode(mode) {
    authMode = mode;
    hideAuthError();
    elAuthPassword.value = '';
    elAuthError.textContent = '';
    if (mode === 'register') {
      elAuthSub.textContent = '注册一个账号，坚持你的习惯';
      elAuthPasswordLabel.textContent = '设置密码';
      elAuthPassword.autocomplete = 'new-password';
      elAuthSubmit.textContent = '注册';
      elAuthToggle.textContent = '已有账号？去登录';
      elAuthForgot.classList.add('hidden');
    } else if (mode === 'reset') {
      elAuthSub.textContent = '设置一个新密码';
      elAuthPasswordLabel.textContent = '新密码';
      elAuthPassword.autocomplete = 'new-password';
      elAuthSubmit.textContent = '更新密码';
      elAuthLinks.classList.add('hidden');
    } else {
      elAuthSub.textContent = '登录后继续坚持你的习惯';
      elAuthPasswordLabel.textContent = '密码';
      elAuthPassword.autocomplete = 'current-password';
      elAuthSubmit.textContent = '登录';
      elAuthToggle.textContent = '没有账号？去注册';
      elAuthForgot.classList.remove('hidden');
      elAuthLinks.classList.remove('hidden');
    }
  }

  function friendlyAuthError(err) {
    const msg = (err && (err.message || '')) || '操作失败，请稍后再试';
    if (msg.includes('Invalid login credentials')) return '邮箱或密码不正确';
    if (msg.includes('Email not confirmed')) return '邮箱尚未确认，请先查看邮件中的确认链接';
    if (msg.includes('User already registered')) return '该邮箱已注册，请直接登录';
    if (msg.includes('Password should be at least')) return '密码至少 6 位';
    if (msg.includes('rate limit') || msg.includes('Too many')) return '操作太频繁，请稍后再试';
    return msg;
  }

  async function onAuthSubmit() {
    if (authSubmitted) return;
    const email = elAuthEmail.value.trim();
    const password = elAuthPassword.value;

    if (authMode === 'reset') {
      if (password.length < 6) { showAuthError('新密码至少 6 位'); return; }
      hideAuthError();
      authSubmitted = true;
      elAuthSubmit.disabled = true;
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        showToast('密码已更新，请重新登录');
        await supabase.auth.signOut();
        setAuthMode('login');
      } catch (err) {
        showAuthError(friendlyAuthError(err));
      } finally {
        authSubmitted = false;
        elAuthSubmit.disabled = false;
      }
      return;
    }

    if (!email || !password) { showAuthError('请输入邮箱和密码'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('邮箱格式不正确'); return; }
    if (password.length < 6) { showAuthError('密码至少 6 位'); return; }
    hideAuthError();
    authSubmitted = true;
    elAuthSubmit.disabled = true;
    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data && data.session) {
          showToast('注册成功，已自动登录！');
        } else {
          setAuthMode('login');
          showAuthError('注册成功！请到邮箱点击确认链接，然后回来登录。');
        }
      }
    } catch (err) {
      showAuthError(friendlyAuthError(err));
    } finally {
      authSubmitted = false;
      elAuthSubmit.disabled = false;
    }
  }

  async function onAuthForgot() {
    const email = elAuthEmail.value.trim();
    if (!email) { showAuthError('请输入邮箱'); return; }
    hideAuthError();
    try {
      const siteUrl = window.location.origin + window.location.pathname;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: siteUrl });
      if (error) throw error;
      showToast('重置邮件已发送，请查收');
    } catch (err) {
      showAuthError(friendlyAuthError(err));
    }
  }

  async function onLogout() {
    await supabase.auth.signOut();
    habits = [];
    checkins.clear();
    render();
  }

  // ---------- 会话 ----------
  function applyAuthState() {
    if (currentUser) {
      elAuthView.classList.add('hidden');
      elAppView.classList.remove('hidden');
      elAccountEmail.textContent = currentUser.email || '';
      loadData();
    } else {
      elAppView.classList.add('hidden');
      elAuthView.classList.remove('hidden');
    }
  }

  async function setupAuth() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    currentUser = data && data.session ? data.session.user : null;
    applyAuthState();
    supabase.auth.onAuthStateChange((event, session) => {
      currentUser = session ? session.user : null;
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('reset');
        currentUser = null; // 重置密码流程：不进入主界面
        elAppView.classList.add('hidden');
        elAuthView.classList.remove('hidden');
        return;
      }
      applyAuthState();
    });
  }

  // ---------- 实时同步 ----------
  function setupRealtime() {
    if (!supabase || realtimeReady) return;
    realtimeReady = true;
    supabase
      .channel('habit-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => loadData())
      .subscribe();
  }

  // ---------- 跨零点自动刷新 ----------
  function scheduleMidnightRefresh() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    midnightTimer = setTimeout(() => {
      todayKey = fmtDate(new Date());
      loadData();
      scheduleMidnightRefresh();
    }, next - now);
  }

  // ---------- 事件绑定 & 启动 ----------
  function bindEvents() {
    $('#btnAdd').addEventListener('click', openModal);
    $('#btnCancel').addEventListener('click', closeModal);
    $('#btnSave').addEventListener('click', onSave);
    $('#btnLogout').addEventListener('click', onLogout);
    elAuthSubmit.addEventListener('click', onAuthSubmit);
    elAuthToggle.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(authMode === 'login' ? 'register' : 'login');
    });
    elAuthForgot.addEventListener('click', (e) => { e.preventDefault(); onAuthForgot(); });
    elAuthPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') onAuthSubmit(); });
    elModal.addEventListener('click', (e) => { if (e.target === elModal) closeModal(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeAllMenus(); });
    window.addEventListener('focus', () => { if (document.visibilityState === 'visible') loadData(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadData(); });
  }

  function init() {
    buildEmojiPicker();
    bindEvents();
    render();
    if (!configured) {
      elConfigBanner.classList.remove('hidden');
      return;
    }
    setupRealtime();
    scheduleMidnightRefresh();
    setupAuth();
  }

  init();
})();
