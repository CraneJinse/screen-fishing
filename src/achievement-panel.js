(function achievementPanelModule() {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ui = { series: '', status: '', query: '', sort: 'catalog', filtersOpen: false };
  let host;
  let openedId = null;
  let detailSignature = '';
  let pendingRefresh = false;
  const game = () => window.PondGame;
  const state = () => host.snapshot().state;
  const catalog = () => host.snapshot().achievements || game().ACHIEVEMENTS || [];
  const tracked = () => state().achievementTracking || [];
  const awardedPoints = item => state().achievements?.includes(item.id)
    ? Number(state().achievementMetadata?.[item.id]?.pointsAtUnlock ?? item.points) : item.points;
  function summary() {
    return game().achievementSummary(state());
  }
  function details(item) {
    return game().achievementDetails(state(), item.id);
  }
  function icon(item, detail = false) {
    const path = item.iconPath || `assets/ui/achievements-v2/${item.id}.png`;
    return `<span class="achievement-art${detail ? ' achievement-art-large' : ''}"><img src="../${esc(path.replace(/^\.\.\//, ''))}" alt="" decoding="async" onerror="this.hidden=true;this.parentElement.classList.add('art-missing')"><span class="achievement-art-fallback" aria-hidden="true">✦</span></span>`;
  }
  function number(value) {
    return Number.isInteger(Number(value)) ? Number(value).toLocaleString('zh-CN') : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  function progressMarkup(item, info, detail = false) {
    const progress = Math.max(0, Number(info.progress) || 0);
    const target = Number(info.target ?? item.target) || 1;
    const shown = info.unlocked ? target : Math.min(progress, target);
    const percent = Math.min(100, shown / target * 100);
    const unit = /LengthCm/.test(item.stat) ? ' cm' : /WeightKg/.test(item.stat) ? ' kg' : '';
    return `<span class="achievement-progress${detail ? ' detail-progress' : ''}"><strong>${number(shown)} / ${number(target)}${unit}</strong><span class="achievement-meter" role="progressbar" aria-label="${esc(item.name)}进度" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${shown}"><i style="width:${percent}%"></i></span><small class="${info.unlocked ? 'achievement-complete' : ''}">${info.unlocked ? '已达成' : '进行中'}</small></span>`;
  }
  function rows() {
    let items = catalog().map(item => ({ item, info: details(item) }));
    const query = ui.query.trim().toLocaleLowerCase();
    items = items.filter(({ item, info }) => (!ui.series || String(item.seriesId) === ui.series)
      && (!ui.status || (ui.status === 'unlocked' ? info.unlocked : ui.status === 'tracked' ? tracked().includes(item.id) : !info.unlocked))
      && (!query || `${item.name} ${item.description} ${item.seriesName} ${item.number}`.toLocaleLowerCase().includes(query)));
    items.sort((a, b) => {
      if (ui.sort === 'recent') return (Number(state().achievementTimes?.[b.item.id]) || 0) - (Number(state().achievementTimes?.[a.item.id]) || 0) || a.item.number - b.item.number;
      if (ui.sort === 'near') return Number(a.info.unlocked) - Number(b.info.unlocked) || Math.min(1, b.info.progress / b.item.target) - Math.min(1, a.info.progress / a.item.target) || a.item.number - b.item.number;
      return a.item.number - b.item.number;
    });
    return items;
  }
  function options(items, selected) {
    return items.map(([id, name]) => `<option value="${esc(id)}"${String(selected) === String(id) ? ' selected' : ''}>${esc(name)}</option>`).join('');
  }
  function render() {
    const total = summary();
    const list = rows();

    const notice = state().achievementNotice;
    const noticeIds = (notice?.ids || []).filter(id => catalog().some(a => a.id === id));
    const noticePoints = catalog().filter(a => noticeIds.includes(a.id)).reduce((sum, a) => sum + awardedPoints(a), 0);
    const trackedItems = catalog().filter(a => tracked().includes(a.id));
    return `<div class="achievements-page">
      <section class="achievement-overview" aria-label="成就总进度"><div><strong>${total.unlocked}<small> / ${total.total}</small></strong><span>已达成</span></div><div><strong>${total.points}<small> / ${total.totalPoints}</small></strong><span>成就点</span></div></section>
      ${noticeIds.length ? `<aside class="achievement-notice" role="status"><span><strong>${notice.source === 'migration' || notice.source === 'retroactive' ? '历史进度已补发' : '获得新成就'}</strong><span>${noticeIds.length} 条成就 · ${noticePoints} 点，已自动保存</span></span><button class="pixel-button" data-achievement-action="acknowledge" type="button">知道了</button></aside>` : ''}
      <section class="achievement-tracking" aria-label="关注目标"><span>关注 ${trackedItems.length}/3</span>${trackedItems.length ? trackedItems.map(a => `<button type="button" data-achievement="${esc(a.id)}">${esc(a.name)}</button>`).join('') : '<small>打开成就详情，可关注最多 3 个目标</small>'}</section>
      <section class="achievement-searchbar"><input id="achievementSearch" aria-label="搜索成就" type="search" placeholder="搜索名称或达成条件" value="${esc(ui.query)}" autocomplete="off"><button class="pixel-button" data-achievement-action="filters" type="button" aria-expanded="${ui.filtersOpen}" aria-controls="achievementFilterControls">筛选与排序</button></section><section id="achievementFilterControls" class="achievement-filters" aria-label="筛选成就" ${ui.filtersOpen ? '' : 'hidden'}><label>系列<select id="achievementSeries">${options([['', '全部系列'], ...total.series.map(s => [s.id, `${s.name} ${s.unlocked}/${s.total}`])], ui.series)}</select></label><label>状态<select id="achievementStatus">${options([['', '全部状态'], ['locked', '未达成'], ['unlocked', '已达成'], ['tracked', '已关注']], ui.status)}</select></label><label>排序<select id="achievementSort">${options([['catalog', '成就顺序'], ['recent', '最近达成'], ['near', '接近达成']], ui.sort)}</select></label></section>
      <div class="achievement-list-caption"><span aria-live="polite">显示 ${list.length} 条成就</span><button type="button" class="achievement-reset" data-achievement-action="reset">重置筛选</button></div>
      <section class="achievement-list" aria-label="成就列表">${list.length ? list.map(({ item, info }) => `<button class="achievement-row ${info.unlocked ? 'is-unlocked' : 'is-locked'}" data-achievement="${esc(item.id)}" type="button" aria-label="${esc(item.name)}，${esc(item.description)}，${info.unlocked ? '已达成' : '未达成'}，查看详情">${icon(item)}<span class="achievement-copy"><strong>${esc(item.name)}</strong><span class="achievement-condition">${esc(item.description)}</span><span class="achievement-meta">${esc(item.seriesName)} · ${awardedPoints(item)} 点${tracked().includes(item.id) ? '<b>已关注</b>' : ''}</span></span>${progressMarkup(item, info)}</button>`).join('') : '<div class="achievement-empty"><strong>没有符合条件的成就</strong><p>试试其他系列、状态或关键词。</p><button class="pixel-button" data-achievement-action="reset" type="button">显示全部成就</button></div>'}</section>
      <p class="achievement-footnote">成就永久保留，暂停与退出不影响进度。</p>
    </div>`;
  }
  function show(id) {
    const item = catalog().find(a => a.id === id);
    if (!item) return host.toast('成就资料暂不可用', true);
    openedId = id;
    const info = details(item);
    detailSignature = JSON.stringify([info, tracked(), state().achievementTimes?.[id], state().achievements]);

    const tracking = tracked().includes(id);
    document.getElementById('modalContent').innerHTML = `<section class="achievement-detail"><div class="achievement-detail-head">${icon(item, true)}<div><span class="achievement-meta">${esc(item.seriesName)}</span><h2>${esc(item.name)}</h2><span class="achievement-points">${esc(({ 1: '起步', 2: '进阶', 3: '珍藏', 4: '里程碑' })[item.tier] || '')} · ${awardedPoints(item)} 点</span></div></div><p class="achievement-detail-condition">${esc(item.description)}</p>${progressMarkup(item, info, true)}${info.hint && !info.corners?.length ? `<p class="achievement-explanation">${esc(info.hint)}</p>` : ''}${info.corners?.length ? `<div class="achievement-corners" aria-label="四角完成情况">${info.corners.map(c => `<span class="${c.completed ? 'done' : ''}">${c.completed ? '✓' : '○'} ${esc(c.name)}</span>`).join('')}</div><p class="achievement-explanation">把小船拖到屏幕角落附近后抛竿，不必贴边。</p>` : ''}${info.partialHistory && !info.unlocked ? '<p class="achievement-explanation">旧档只补发可核实的历史进度，其余会随之后的游玩继续积累。</p>' : ''}<div class="achievement-detail-facts"><span>${info.source === 'retroactive' ? '历史进度补发时间' : '达成时间'}<strong>${info.unlocked ? esc(host.dateText(state().achievementTimes?.[id])) : '尚未达成'}</strong></span></div><button class="pixel-button achievement-track-button" data-achievement-action="track" data-achievement-id="${esc(id)}" type="button" aria-pressed="${tracking}">${tracking ? '取消关注' : '关注目标'}</button><p class="achievement-explanation">最多关注 3 条成就。成就点仅用于收藏展示。</p></section>`;
    const dialog = document.getElementById('detailModal');
    dialog.setAttribute('aria-label', `${item.name}成就详情`);
    dialog.addEventListener('close', () => dialog.removeAttribute('aria-label'), { once: true });
    if (!dialog.open) dialog.showModal();
    bindActions(document.getElementById('modalContent'));
  }
  async function action(type, payload = {}) {
    try {
      const result = await window.desktopPond.action(`achievement-${type}`, payload);
      if (!result?.ok) {
        const message = result?.reason === 'tracking-limit' || result?.reason === 'track-limit' ? '最多关注 3 条，请先取消一个目标' : '成就设置未能保存，请重试';
        host.toast(message, true); host.refresh(false); return false;
      }
      if (result.snapshot) host.update(result.snapshot);
      else host.update(await window.desktopPond.getSnapshot());
      host.refresh(false);
      return true;
    } catch { host.toast('成就设置保存失败，请稍后重试', true); host.refresh(false); return false; }
  }
  function bindActions(root) {
    root.querySelectorAll('[data-achievement-action]').forEach(button => {
      button.onclick = async event => {
        event.stopPropagation();
        const type = button.dataset.achievementAction;
        if (type === 'filters') { ui.filtersOpen = !ui.filtersOpen; host.refresh(false); return; }
        if (type === 'reset') { Object.assign(ui, { series: '', status: '', query: '', sort: 'catalog' }); host.refresh(true); return; }
        if (type === 'track' && !tracked().includes(button.dataset.achievementId) && tracked().length >= 3) { host.toast('最多关注 3 条，请先取消一个目标', true); return; }
        button.disabled = true;
        const ok = await action(type, { id: button.dataset.achievementId });
        if (!ok) button.disabled = false;
        if (ok && type === 'track') show(openedId);
      };
    });
  }
  function bind() {
    bindActions(document.getElementById('app'));
    [['achievementSeries', 'series'], ['achievementStatus', 'status'], ['achievementSort', 'sort']].forEach(([id, key]) => {
      document.getElementById(id).onchange = event => { ui[key] = event.target.value; host.refresh(true); document.getElementById(id)?.focus({ preventScroll: true }); };
    });

    const search = document.getElementById('achievementSearch');
    const onSearch = event => {
      if (event.isComposing) return;
      const start = event.target.selectionStart;
      ui.query = event.target.value;
      host.refresh(true);
      const next = document.getElementById('achievementSearch');
      next.focus({ preventScroll: true });
      if (Number.isInteger(start)) next.setSelectionRange(start, start);
    };
    search.oninput = onSearch;
    search.oncompositionend = onSearch;
    document.querySelectorAll('.achievements-page input,.achievements-page select').forEach(input => {
      input.addEventListener('blur', () => {
        if (!pendingRefresh) return;
        pendingRefresh = false;
        // Let the browser commit select changes before the pending snapshot paints.
        setTimeout(() => { if (document.querySelector('.achievements-page')) host.refresh(false); }, 0);
      });
    });
  }
  function deferUpdate() {
    if (!document.activeElement?.matches('.achievements-page input,.achievements-page select')) return false;
    pendingRefresh = true;
    return true;
  }
  function refreshDetail() {
    const dialog = document.getElementById('detailModal');
    const item = catalog().find(a => a.id === openedId);
    if (!dialog.open || !dialog.querySelector('.achievement-detail') || !item) return;
    const next = JSON.stringify([details(item), tracked(), state().achievementTimes?.[openedId], state().achievements]);
    if (next === detailSignature) return;
    const scroll = dialog.scrollTop;
    const action = dialog.contains(document.activeElement) ? document.activeElement.dataset.achievementAction : null;
    show(openedId);
    if (action) dialog.querySelector(`[data-achievement-action="${action}"]`)?.focus({ preventScroll: true });
    dialog.scrollTop = scroll;
  }
  function notify(previous, next) {
    const notice = next?.state?.achievementNotice;
    if (!notice?.ids?.length || document.hidden || document.querySelector('.achievements-page')) return;
    const previousIds = new Set(previous?.state?.achievementNotice?.ids || []);
    const added = notice.ids.filter(id => !previousIds.has(id));
    if (added.length) host.toast((notice.source === 'retroactive' ? '历史进度补发' : '新成就达成') + ' ' + added.length + ' 条，可在成就页查看');
  }
  window.PondAchievementPanel = { configure: config => { host = config; }, render, bind, show, notify, deferUpdate, refreshDetail };
})();
