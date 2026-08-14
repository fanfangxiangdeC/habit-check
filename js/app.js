/* ===== 习惯打卡 · 页面逻辑 ===== */
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
  let toggling = new Set();              // 正在切换的习惯，防重复点击

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

  // ---------- 数据加载 ----------
  async function loadData() {
    if (!supabase) return;
    try {
      const [hRes, cRes] = await Promise.all([
        supabase.from('habits').select('*').order('created_at', { ascending: true }),
        supabase.from('checkins').select('*'),
      ]);
      if (hRes.error) throw hRes.error;
      if (cRes.error) throw cRes.error;

      habits = hRes.data || [];
      checkins = new Map();
      for (const row of cRes.data || []) {
        if (!checkins.has(row.habit_id)) checkins.set(row.habit_id, new Set());
        checkins.get(row.habit_id).add(row.date);
      }
      render();
    } catch (err) {
      showToast('加载数据失败：' + err.message);
    }
  }

  // ---------- 勾选/取消 ----------
  async function toggleCheck(habitId) {
    if (!supabase || toggling.has(habitId)) return;
    toggling.add(habitId);
    const doneSet = checkins.get(habitId) || new Set();
    const wasChecked = doneSet.has(todayKey);

    // 乐观更新
    if (wasChecked) doneSet.delete(todayKey); else doneSet.add(todayKey);
    render();

    try {
      if (wasChecked) {
        const { error } = await supabase.from('checkins')
          .delete().eq('habit_id', habitId).eq('date', todayKey);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('checkins')
          .insert({ habit_id: habitId, date: todayKey });
        if (error) throw error;
      }
    } catch (err) {
      // 回滚
      if (wasChecked) doneSet.add(todayKey); else doneSet.delete(todayKey);
      render();
      showToast('操作失败：' + err.message);
    } finally {
      toggling.delete(habitId);
    }
  }

  // ---------- 添加 / 重命名 / 删除 ----------
  async function addHabit(name, emoji) {
    const { data, error } = await supabase.from('habits')
      .insert({ name, emoji: emoji || '📌' }).select().single();
    if (error) throw error;
    habits.push(data);
    render();
  }

  async function renameHabit(id, name) {
    const { error } = await supabase.from('habits').update({ name }).eq('id', id);
    if (error) throw error;
    const h = habits.find((x) => x.id === id);
    if (h) h.name = name;
    render();
  }

  async function deleteHabit(id) {
    if (!confirm('确定删除这个习惯吗？它的打卡记录也会一起删除。')) return;
    try {
      const { error } = await supabase.from('habits').delete().eq('id', id);
      if (error) throw error;
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

  // ---------- 实时同步 ----------
  function setupRealtime() {
    if (!supabase) return;
    supabase
      .channel('habit-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => loadData())
      .subscribe();
  }

  // ---------- 跨零点自动刷新 ----------
  function scheduleMidnightRefresh() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    setTimeout(() => {
      todayKey = fmtDate(new Date());
      loadData();
      scheduleMidnightRefresh();
    }, next - now);
  }

  // ---------- 事件绑定 & 启动 ----------
  function init() {
    $('#btnAdd').addEventListener('click', openModal);
    $('#btnCancel').addEventListener('click', closeModal);
    $('#btnSave').addEventListener('click', onSave);
    elModal.addEventListener('click', (e) => { if (e.target === elModal) closeModal(); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu')) closeAllMenus();
    });
    buildEmojiPicker();
    render();

    if (!configured) {
      elConfigBanner.classList.remove('hidden');
      return;
    }
    setupRealtime();
    loadData();
    scheduleMidnightRefresh();
    window.addEventListener('focus', () => { if (document.visibilityState === 'visible') loadData(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadData(); });
  }

  init();
})();
