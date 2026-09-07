(function panelRenderer() {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let snapshot;
  let routeStack = [{ page: 'home' }];
  let toastTimer;
  let characterBusy = false;
  let pendingScale = null;
  let scalePreviewPromise = null;
  let inventoryDisplayFilter = 'all';
  let inventoryBulkMode = false;
  let pendingSaleIds = [];
  let variantObserver = null;
  let pageVisible = true;
  let pendingPackId = null;
  let pendingEquipmentId = null;
  let pendingAquariumItemId = null;
  let shopTab = 'packs';
  let aquariumHabitat = 'freshwater';
  let aquariumShopHabitat = 'all';
  let aquariumShopCategory = 'all';
  let aquariumShopOwned = 'all';
  let layoutDraft = null;
  let layoutUndo = [];
  let layoutRedo = [];
  let selectedDecorInstanceId = null;
  let pendingTankHabitat = null;
  const selectedInventoryIds = new Set();
  const filters = {
    history: { pack: '', rarity: '', query: '', sort: 'newest' }
  };
  const CATALOG_PACK_ORDER = Object.freeze(['F1', 'F2', 'S1', 'S2']);
  const CATALOG_RARITY_ORDER = Object.freeze({ common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 });
  const VARIANT_ORDER = Object.freeze(['normal', 'alternate', 'golden', 'iridescent']);
  const VARIANT_NAMES = Object.freeze({ normal: '原色', alternate: '异色', golden: '纯金', iridescent: '炫彩' });
  const HABITAT_NAMES = Object.freeze({ freshwater: '淡水', saltwater: '咸水' });
  const AQUARIUM_BASE = Object.freeze({ width: 512, height: 288 });
  const AQUARIUM_WATER = Object.freeze({ x: 32, y: 34, width: 448, height: 192, substrateHeight: 28 });
  const previewAlphaBounds = new Map();
  const AQUARIUM_CATEGORY_NAMES = Object.freeze({ tank: '鱼缸款式', skin: '鱼缸款式', substrate: '底砂', rock: '石材/洞穴', plant: '水草/珊瑚', wood: '沉木', driftwood: '沉木', background: '背景', effect: '轻效果', decor: '装饰' });
  const SPECIAL_SERIES = Object.freeze([
    { id: 'drift_bottle', name: '漂流瓶', total: 30, icon: '../assets/events/drift-bottle/cover.png' },
    { id: 'research_salvage', name: '科研标记', total: 10, icon: '../assets/events/research-salvage/cover.png' },
    { id: 'eco_cleanup', name: '生态守护', total: 20, icon: '../assets/events/eco-cleanup/cover.png' }
  ]);
  const SPECIAL_SERIES_BY_ID = Object.freeze(Object.fromEntries(SPECIAL_SERIES.map((item) => [item.id, item])));
  function specialEntries(seriesId) {
    const collection = snapshot?.state?.specialEventCollection?.entries || {};
    const catalog = (snapshot?.specialEventCatalog || []).filter((item) => item.seriesId === seriesId).sort((a, b) => a.order - b.order);
    return catalog.map((item) => { const record = collection[item.id] || {}; const discovered = Number(record.count) > 0 || Boolean(record.firstFoundAt || record.firstAt); return { ...item, record, discovered }; });
  }
  const SORT_MODES = Object.freeze([
    ['capture', '捕获顺序'], ['catalog', '图鉴顺序'], ['rarity', '稀有度顺序'], ['variant', '异色顺序']
  ]);
  const makeListUi = (mode, direction) => ({ mode, direction, query: '', filtersOpen: false, sortsOpen: false, packs: new Set(CATALOG_PACK_ORDER), rarities: new Set(Object.keys(CATALOG_RARITY_ORDER)), variants: new Set(VARIANT_ORDER) });
  const listUi = {
    catalog: makeListUi('catalog', 'asc'),
    warehouse: makeListUi('capture', 'desc'),
    aquarium: makeListUi('capture', 'desc')
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const dateText = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
  const coinText = (value) => `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('zh-CN')} 金币`;
  function achievementValue(value, achievement) {
    const id = String(achievement?.id || '');
    return /length|weight/i.test(id) ? Number(value || 0).toFixed(2) : String(Math.round(Number(value || 0)));
  }
  const rootAsset = (relative) => `../${relative.replace(/\\/g, '/')}`;
  const manifest = (id) => snapshot?.assets?.manifests?.find((item) => item.id === id);
  function fishEntry(fishId) {
    for (const bundle of (snapshot?.assets?.manifests || []).filter((item) => item.id === 'fish')) {
      const entry = (bundle.data.entries || []).find((item) => (item.fishId || item.id || `fish-${item.catalogIndex}`) === fishId);
      if (entry) return { entry, bundle };
    }
    return null;
  }
  function variantEntry(fishId) {
    const bundles = (snapshot?.assets?.manifests || []).filter((item) => item.id === 'fish-variants' || item.id === 'fish_variants');
    for (const bundle of bundles) { const entry = (bundle.data.entries || []).find((item) => item.fishId === fishId); if (entry) return { entry, bundle }; }
    return null;
  }
  function catalogPresentation(fishId) {
    const scale = Number(variantEntry(fishId)?.entry?.presentation?.catalogScale);
    return Number.isFinite(scale) && scale >= 0.68 && scale < 1 ? scale : 1;
  }
  function normalizeVariant(value) { return VARIANT_ORDER.includes(value) ? value : 'normal'; }
  function variantRecord(record, variant) {
    const normalized = normalizeVariant(variant);
    if (!record) return null;
    if (normalized === 'normal' && !record.variants) return record;
    return record.variants?.[normalized] || null;
  }
  function variantDiscovered(record, variant) {
    const item = variantRecord(record, variant);
    return Boolean(item && (Number(item.count) > 0 || item.firstAt));
  }
  function variantAsset(fishId, variant = 'normal') {
    const selected = normalizeVariant(variant);
    const found = selected === 'normal' ? fishEntry(fishId) : (variantEntry(fishId) || fishEntry(fishId));
    if (!found) return null;
    const { entry, bundle } = found;
    const normal = entry.icon || entry.path;
    const data = entry.variants?.[selected] || null;
    const icon = data?.icon || (selected === 'normal' ? normal : null);
    if (!icon && !(data?.baseIcon && data?.bodyMask && data?.detailOverlay)) return null;
    return { icon: icon ? rootAsset(`${bundle.basePath}/${icon}`) : null, data, bundle };
  }
  function fishAsset(fishId, variant = 'normal') {
    return variantAsset(fishId, variant)?.icon || 'ui-assets/fish-unknown.svg';
  }
  function achievementAsset(achievementId) {
    const bundle = manifest('achievements');
    const entry = bundle?.data?.entries?.find((item) => item.achievementId === achievementId);
    return entry?.icon ? rootAsset(`${bundle.basePath}/${entry.icon}`) : null;
  }
  function measurementProfile(fishId) {
    const bundle = manifest('measurements');
    return PondMeasurements.profileMap(bundle?.data || {})[fishId] || null;
  }
  function fishFrame(fish, discovered = true, variant = 'normal', extraClass = '', frameStyle = '') {
    if (!discovered) return '<div class="fish-frame"><span class="unknown-fish">?</span></div>';
    const style = frameStyle ? ` style="${escapeHtml(frameStyle)}"` : '';
    const selected = normalizeVariant(variant);
    const asset = variantAsset(fish.id, selected) || variantAsset(fish.id, 'normal');
    const fallback = selected !== 'normal' && asset && selected !== 'iridescent' ? '' : 'ui-assets/fish-unknown.svg';
    if (!asset) return `<div class="fish-frame ${extraClass}"${style}><img src="${fallback}" alt="${escapeHtml(fish.name)}" onerror="this.src='ui-assets/fish-unknown.svg'"></div>`;
    if (selected === 'iridescent' && asset.data?.baseIcon && asset.data?.bodyMask && asset.data?.detailOverlay) {
      const root = (path) => rootAsset(`${asset.bundle.basePath}/${path}`);
      return `<div class="fish-frame variant-frame variant-iridescent ${extraClass}" data-variant="iridescent"${style}><img class="variant-base" src="${escapeHtml(root(asset.data.baseIcon))}" alt="${escapeHtml(fish.name)} 炫彩"><span class="pearl-layer spectrum-clouds" style="--mask:url('${escapeHtml(root(asset.data.bodyMask))}')" aria-hidden="true"></span><span class="pearl-layer spectrum-ribbons" style="--mask:url('${escapeHtml(root(asset.data.bodyMask))}')" aria-hidden="true"></span><span class="pearl-layer pearl-glint" style="--mask:url('${escapeHtml(root(asset.data.bodyMask))}')" aria-hidden="true"></span><img class="detail-overlay" src="${escapeHtml(root(asset.data.detailOverlay))}" alt="" aria-hidden="true"></div>`;
    }
    return `<div class="fish-frame variant-frame variant-${selected} ${extraClass}" data-variant="${selected}"${style}><img src="${escapeHtml(asset.icon)}" alt="${escapeHtml(fish.name)} ${VARIANT_NAMES[selected]}" onerror="this.src='${fallback || 'ui-assets/fish-unknown.svg'}'"></div>`;
  }
  function toast(message, isError = false) {
    const node = $('toast'); node.textContent = message; node.style.background = isError ? '#d56f5d' : '#d7b966'; node.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
  }
  function header(title, subtitle = '', trailing = '') {
    const back = routeStack.length > 1 ? '<button class="back-button" data-action="back" type="button"><img src="../assets/ui/icons/back.svg" alt="">返回</button>' : '<span></span>';
    return `<header class="page-header">${back}<div><h1>${escapeHtml(title)}</h1>${subtitle ? `<small class="muted">${escapeHtml(subtitle)}</small>` : ''}</div><span class="page-header-trailing">${trailing}</span></header>`;
  }
  function currentRoute() { return routeStack[routeStack.length - 1]; }
  function aquariumEnabled() { return snapshot?.app?.features?.aquarium === true; }
  function navigate(route, replace = false) {
    currentRoute().scrollTop = $('app').scrollTop;
    const requested = route || { page:'home' };
    const target = !aquariumEnabled() && String(requested.page || '').startsWith('aquarium')
      ? { page:'home', scrollTop:0 }
      : { ...requested, scrollTop: 0 };
    if (replace) routeStack[routeStack.length - 1] = target; else routeStack.push(target);
    render();
  }
  async function back() {
    if (currentRoute().page === 'aquarium-layout') {
      await runAquariumAction('open-layout', { active: false, habitat: aquariumHabitat, tankId: currentRoute().tankId || aquariumData().activeTankId });
      layoutDraft = null; layoutUndo = []; layoutRedo = []; selectedDecorInstanceId = null;
    }
    if (routeStack.length > 1) { routeStack.pop(); render(); }
    else window.desktopPond.closePanel();
  }
  function statsCard(value, label) { return `<div class="stat"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`; }
  function renderHome() {
    const state = snapshot.state;
    const records = PondGame.personalRecordSummary(state);
    return `${header('个人记录', `最长记录 ${records.longest} · 最沉记录 ${records.heaviest}`, `<strong class="page-balance">${escapeHtml(coinText(state.wallet?.balance))}</strong>`)}<section class="stats-strip home-stats">${statsCard(`${state.stats.uniqueSpeciesCount}/152`, '已发现')}${statsCard(state.stats.totalCatchCount, '总捕获')}${statsCard(state.history[0]?.name || '—', '最近收获')}</section><section class="home-grid">
      ${homeButton('encyclopedia', 'catalog', '鱼类图鉴')}${homeButton('warehouse', 'warehouse', '鱼类仓库')}${homeButton('shop', 'shop', '商店')}${homeButton('special-events', 'special-event', '特殊事件')}${homeButton('achievements', 'achievements', '成就')}${homeButton('characters', 'characters', '角色库')}${homeButton('history', 'history', '历史收获')}${homeButton('settings', 'settings', '设置')}${homeButton('help', 'help', '玩法帮助')}
    </section>`;
  }
  function homeButton(page, icon, title) { return `<button class="home-card" data-page="${page}" type="button"><span class="home-icon"><img src="../assets/ui/icons/${icon}.svg" alt=""></span><strong>${title}</strong></button>`; }
  function catalogIndex(fish) {
    const declared = Number(fish?.catalogIndex);
    if (Number.isInteger(declared)) return declared;
    const match = /^fish-(\d+)$/.exec(String(fish?.id || ''));
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }
  function listRecordMeta(record) {
    const fish = record?.inventoryId ? inventoryFish(record) : record;
    const pack = record?.pack || fish?.pack || '';
    const rarity = record?.rarity || fish?.rarity || 'common';
    const variant = normalizeVariant(record?.variant);
    return {
      pack, rarity, variant,
      packRank: CATALOG_PACK_ORDER.indexOf(pack) < 0 ? 99 : CATALOG_PACK_ORDER.indexOf(pack),
      rarityRank: CATALOG_RARITY_ORDER[rarity] ?? 99,
      variantRank: VARIANT_ORDER.indexOf(variant),
      catalogRank: catalogIndex(fish),
      caughtAt: Number(record?.caughtAt || record?.at || 0),
      name: String(record?.name || fish?.name || '')
    };
  }
  function compareListRecords(left, right, mode, direction) {
    const a = listRecordMeta(left); const b = listRecordMeta(right); const sign = direction === 'desc' ? -1 : 1;
    const fields = mode === 'rarity' ? ['rarityRank', 'packRank', 'variantRank', 'catalogRank']
      : mode === 'variant' ? ['variantRank', 'packRank', 'rarityRank', 'catalogRank']
        : mode === 'catalog' ? ['packRank', 'rarityRank', 'variantRank', 'catalogRank']
          : ['caughtAt', 'catalogRank', 'rarityRank', 'variantRank'];
    for (const field of fields) if (a[field] !== b[field]) return (a[field] - b[field]) * sign;
    return a.name.localeCompare(b.name, 'zh-CN') * sign;
  }
  function selectedCatalogVariant(ui, record) {
    if (ui.variants.size === VARIANT_ORDER.length) return 'normal';
    const chosen = [...ui.variants].sort((a, b) => VARIANT_ORDER.indexOf(b) - VARIANT_ORDER.indexOf(a));
    return chosen.find((variant) => variantDiscovered(record, variant)) || chosen[0] || 'normal';
  }
  function listMatches(record, scope) {
    const ui = listUi[scope]; const meta = listRecordMeta(record);
    return ui.packs.has(meta.pack) && ui.rarities.has(meta.rarity) && ui.variants.has(meta.variant)
      && (!ui.query || meta.name.toLocaleLowerCase('zh-CN').includes(ui.query.toLocaleLowerCase('zh-CN')));
  }
  function multiFilterGroup(scope, field, title, values, labels) {
    const selected = listUi[scope][field];
    return `<fieldset><legend>${title}</legend>${values.map((value) => `<label><input type="checkbox" data-list-scope="${scope}" data-list-field="${field}" value="${escapeHtml(value)}" ${selected.has(value) ? 'checked' : ''}>${escapeHtml(labels[value] || value)}</label>`).join('')}</fieldset>`;
  }
  function listToolbar(scope, { placeholder = '搜索鱼名', trailing = '' } = {}) {
    const ui = listUi[scope];
    const sortButtons = SORT_MODES.map(([mode, label]) => {
      const active = ui.mode === mode; const arrow = active ? (ui.direction === 'asc' ? '↑' : '↓') : '';
      return `<button class="pixel-button compact ${active ? 'active' : ''}" data-action="list-sort" data-list-scope="${scope}" data-sort-mode="${mode}" type="button" aria-pressed="${active}">${label}${arrow}</button>`;
    }).join('');
    const activeLabel = SORT_MODES.find(([mode]) => mode === ui.mode)?.[1] || '排序';
    const arrow = ui.direction === 'asc' ? '↑' : '↓';
    const sortControl = scope === 'catalog'
      ? `<div class="list-sort-group catalog-sort-only" aria-label="排序方式"><button class="pixel-button compact active" data-action="list-sort" data-list-scope="catalog" data-sort-mode="catalog" type="button" aria-pressed="true">图鉴顺序${arrow}</button></div>`
      : scope === 'warehouse'
        ? `<div class="list-sort-dropdown"><button class="pixel-button compact active" data-action="list-sort-toggle" data-list-scope="warehouse" type="button" aria-haspopup="menu" aria-expanded="${ui.sortsOpen}">排序：${activeLabel} ${arrow}${ui.sortsOpen ? ' ▲' : ' ▼'}</button>${ui.sortsOpen ? `<div class="list-sort-menu" role="menu">${SORT_MODES.map(([mode, label]) => `<button class="pixel-button compact ${ui.mode === mode ? 'active' : ''}" data-action="list-sort-option" data-list-scope="warehouse" data-sort-mode="${mode}" type="button" role="menuitem">${label}${ui.mode === mode ? ` ${arrow}` : ''}</button>`).join('')}</div>` : ''}</div>`
        : `<div class="list-sort-group" aria-label="排序方式">${sortButtons}</div>`;
    return `<div class="unified-list-toolbar list-toolbar-${scope}">${sortControl}<button class="pixel-button compact ${ui.filtersOpen ? 'active' : ''}" data-action="list-filter-toggle" data-list-scope="${scope}" type="button" aria-expanded="${ui.filtersOpen}">筛选${ui.filtersOpen ? '▲' : '▼'}</button><input class="list-search" data-list-search="${scope}" value="${escapeHtml(ui.query)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}">${trailing}</div>${ui.filtersOpen ? `<section class="multi-filter-panel">${multiFilterGroup(scope, 'packs', '鱼包', CATALOG_PACK_ORDER, snapshot.packs)}${multiFilterGroup(scope, 'rarities', '稀有度', Object.keys(CATALOG_RARITY_ORDER), snapshot.rarityNames)}${multiFilterGroup(scope, 'variants', '异色', VARIANT_ORDER, VARIANT_NAMES)}</section>` : ''}`;
  }
  function catalogCard(fish, index, selectedVariant = 'normal', allVariants = true) {
    const record = snapshot.state.collection[fish.id];
    const variant = normalizeVariant(selectedVariant);
    const discovered = variantDiscovered(record, variant);
    const shown = variant === 'normal' ? Boolean(record) : discovered;
    const foundCount = VARIANT_ORDER.filter((item) => variantDiscovered(record, item)).length;
    const status = allVariants ? `已发现 ${foundCount}/4 变体` : (variant === 'normal' ? (record ? '已发现' : '尚未发现') : (discovered ? `已捕获 ${variantRecord(record, variant)?.count || 0} 次` : '尚未发现'));
    const variantStatus = allVariants ? status : `${VARIANT_NAMES[variant]} · ${status}`;
    const artScale = catalogPresentation(fish.id);
    const artClass = artScale < 1 ? 'catalog-compact-art' : '';
    const artStyle = artScale < 1 ? `--catalog-fish-scale:${artScale}` : '';
    return `<button class="icon-card fish-catalog-card rarity-${fish.rarity} ${shown ? '' : 'locked'}" data-fish="${fish.id}" data-grid-index="${index}" data-locked="${shown ? 'false' : 'true'}" data-variant="${variant}" data-catalog-scale="${artScale}" type="button" aria-label="${shown ? escapeHtml(fish.name) : '尚未发现的鱼'}"><span class="catalog-rarity-band">${escapeHtml(fish.rarityName)}</span>${fishFrame(fish, shown, variant, artClass, artStyle)}<span class="card-name variant-text-${variant}">${shown ? escapeHtml(fish.name) : '???'}</span>${shown ? `<small class="variant-label variant-text-${variant}">${escapeHtml(variantStatus)}</small>` : `<small>${VARIANT_NAMES[variant]} · 尚未发现</small>`}</button>`;
  }
  function renderCatalog() {
    const ui = listUi.catalog;
    const visible = ui.variants.size ? snapshot.catalog.filter((fish) => ui.packs.has(fish.pack) && ui.rarities.has(fish.rarity) && (!ui.query || fish.name.toLocaleLowerCase('zh-CN').includes(ui.query.toLocaleLowerCase('zh-CN')))) : [];
    const packOrder = CATALOG_PACK_ORDER.filter((packId) => ui.packs.has(packId));
    if (ui.mode === 'catalog' && ui.direction === 'desc') packOrder.reverse();
    const allVariants = ui.variants.size === VARIANT_ORDER.length;
    let gridIndex = 0;
    const sections = packOrder.map((packId) => {
      const fishInPack = visible.filter((fish) => fish.pack === packId).map((fish) => ({ fish, selectedVariant: selectedCatalogVariant(ui, snapshot.state.collection[fish.id]) }));
      fishInPack.sort((left, right) => compareListRecords({ ...left.fish, variant: left.selectedVariant }, { ...right.fish, variant: right.selectedVariant }, ui.mode, ui.direction));
      if (!fishInPack.length) return '';
      const cards = fishInPack.map(({ fish, selectedVariant }) => catalogCard(fish, gridIndex++, selectedVariant, allVariants)).join('');
      const total = snapshot.catalog.filter((fish) => fish.pack === packId).length;
      const countText = fishInPack.length === total ? `${total} 种鱼` : `${fishInPack.length} / ${total} 符合筛选`;
      return `<section class="catalog-pack-section" data-catalog-pack="${packId}"><header class="catalog-pack-header"><h2>${escapeHtml(snapshot.packs[packId] || packId)}</h2><small>${escapeHtml(countText)}</small></header><div class="catalog-grid">${cards}</div></section>`;
    }).join('');
    return `${header('鱼类图鉴', `已发现 ${snapshot.state.stats.uniqueSpeciesCount} / 152`)}${listToolbar('catalog')}${sections ? `<div class="catalog-pack-list" data-catalog-order="${packOrder.join(',')}">${sections}</div>` : empty('没有匹配的鱼。')}`;
  }
  function optionList(object, selected) { return Object.entries(object).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join(''); }
  function renderFishDetail(fishId) {
    const fish = snapshot.catalog.find((item) => item.id === fishId);
    const record = snapshot.state.collection[fishId];
    if (!fish || !record) return `${header('鱼类详情')}${empty('这条鱼尚未发现，或者数据已经损坏。')}`;
    const profile = measurementProfile(fishId);
    const description = PondMeasurements.description(profile) || '现实资料暂未收录。';
    const lengthRange = PondMeasurements.rangeText(profile?.lengthCm, 'cm');
    const weightRange = profile?.weightKg
      ? PondMeasurements.rangeText(profile.weightKg, 'kg')
      : PondMeasurements.rangeText(profile?.weightG, 'g');
    return `${header(fish.name, `${fish.packName} · ${fish.rarityName}`)}<article class="detail-card rarity-${fish.rarity}"><div class="detail-hero">${fishFrame(fish)}<div><h2>${escapeHtml(fish.name)}</h2><p class="rarity-label">${fish.rarityName} · ${fish.packName}</p><p class="muted">${escapeHtml(description)}</p>${variantBadges(record)}</div></div><div class="facts">${fact('现实长度范围', lengthRange)}${fact('现实重量范围', weightRange)}${fact('首次捕获', dateText(record.firstAt))}${fact('最近捕获', dateText(record.lastAt))}${fact('累计捕获', `${record.count} 次`)}${fact('个人最大长度', `${record.maxLengthCm.toFixed(1)} cm`)}${fact('个人最大重量', PondGame.formatWeight(record.maxWeightKg))}</div><h3 class="variant-detail-title">颜色图鉴</h3>${variantDetailCards(record, fish)}</article>`;
  }
  function fact(label, value) { return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
  function variantBadges(record) {
    return `<div class="variant-badges">${VARIANT_ORDER.map((variant) => { const item = variantRecord(record, variant); const found = variantDiscovered(record, variant); return `<span class="variant-badge variant-${variant} ${found ? 'found' : 'undiscovered'}">${VARIANT_NAMES[variant]} <b>${found ? (item?.count || 0) : '—'}</b></span>`; }).join('')}</div>`;
  }
  function variantDetailCards(record, fish) {
    const cards = VARIANT_ORDER.map((variant) => {
      const item = variantRecord(record, variant);
      const found = variantDiscovered(record, variant);
      const stats = found
        ? `<dl><div><dt>首次</dt><dd>${escapeHtml(dateText(item.firstAt))}</dd></div><div><dt>次数</dt><dd>${Math.max(0, Number(item.count) || 0)}</dd></div><div><dt>最大长度</dt><dd>${Number(item.maxLengthCm || 0).toFixed(1)} cm</dd></div><div><dt>最大重量</dt><dd>${escapeHtml(PondGame.formatWeight(item.maxWeightKg || 0))}</dd></div></dl>`
        : '<p class="muted">尚未发现</p>';
      return `<article class="variant-detail-card variant-${variant} ${found ? 'found' : 'undiscovered'}" data-detail-variant="${variant}">${fishFrame(fish, found, variant, 'variant-detail-art')}<h4>${VARIANT_NAMES[variant]}</h4>${stats}</article>`;
    }).join('');
    return `<section class="variant-detail-grid">${cards}</section>`;
  }
  function inventoryFish(entry) {
    return snapshot.catalog.find((fish) => fish.id === (entry.fishId || entry.resultId)) || {
      id: entry.fishId || entry.resultId, name: entry.name || '未知鱼类', rarity: entry.rarity || 'common'
    };
  }
  function aquariumData() {
    const current = snapshot?.state?.aquarium || {};
    return {
      ...current,
      activeHabitat: current.activeHabitat === 'saltwater' ? 'saltwater' : 'freshwater',
      activeTankId: current.activeTankId || null,
      settings: current.settings || {},
      ownedItemIds: Array.isArray(current.ownedItemIds) ? current.ownedItemIds : [],
      tankInstances: Array.isArray(current.tankInstances) ? current.tankInstances : null,
      tanks: current.tanks || {}
    };
  }
  function aquariumTanks() {
    const aquarium = aquariumData();
    const raw = aquarium.tankInstances?.length ? aquarium.tankInstances : ['freshwater', 'saltwater'].filter((habitat) => aquarium.tanks?.[habitat]).map((habitat, index) => ({ ...aquarium.tanks[habitat], tankId: `${habitat}-1`, habitat, name: `鱼缸${index + 1}` }));
    return raw.map((source, index) => ({ ...source, tankId: source.tankId || `tank-${index + 1}`, name: source.name || `鱼缸${index + 1}`, habitat: source.habitat === 'saltwater' ? 'saltwater' : 'freshwater', fish: Array.isArray(source.fish) ? source.fish : [], decor: Array.isArray(source.decor) ? source.decor : [] }));
  }
  function aquariumTank(tankIdOrHabitat) {
    const tanks = aquariumTanks(); const aquarium = aquariumData();
    const selected = tanks.find((tank) => tank.tankId === tankIdOrHabitat)
      || tanks.find((tank) => tank.tankId === aquarium.activeTankId)
      || tanks.find((tank) => tank.habitat === tankIdOrHabitat)
      || tanks[0] || {};
    return {
      ...selected,
      fish: Array.isArray(selected.fish) ? selected.fish : [],
      decor: Array.isArray(selected.decor) ? selected.decor : []
    };
  }
  function activeAquariumTank() { return aquariumTank(aquariumData().activeTankId || aquariumHabitat); }
  function aquariumCatalogData() {
    return snapshot?.aquariumCatalog || snapshot?.aquarium?.catalog || snapshot?.assets?.aquariumCatalog || {};
  }
  function aquariumCatalog() {
    const source = aquariumCatalogData();
    if (Array.isArray(source)) return source;
    return Array.isArray(source.items) ? source.items : [];
  }
  function aquariumItem(itemId) {
    return aquariumCatalog().find((item) => (item.itemId || item.id) === itemId) || null;
  }
  function itemIdOf(item) { return item?.itemId || item?.id || ''; }
  function itemCategory(item) { return item?.category || item?.type || 'decor'; }
  function itemPrice(item) {
    return Math.max(0, Number(item?.slot === 'skin' ? (item.purchasePriceCoins ?? item.priceCoins) : item?.priceCoins) || 0);
  }
  function itemAsset(item) {
    const path = item?.icon || item?.preview || item?.asset || item?.path;
    return path ? rootAsset(path) : '../assets/ui/icons/aquarium.svg';
  }
  function previewAlphaBoundsFor(source) {
    if (previewAlphaBounds.has(source)) return previewAlphaBounds.get(source);
    const promise = new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => {
        try {
          const canvas = document.createElement('canvas'); canvas.width = probe.naturalWidth; canvas.height = probe.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(probe, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let left = canvas.width; let top = canvas.height; let right = -1; let bottom = -1;
          for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
            left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
          }
          resolve(right >= left ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1, sourceWidth: canvas.width, sourceHeight: canvas.height }
            : { x: 0, y: 0, width: canvas.width, height: canvas.height, sourceWidth: canvas.width, sourceHeight: canvas.height });
        } catch {
          resolve({ x: 0, y: 0, width: probe.naturalWidth, height: probe.naturalHeight, sourceWidth: probe.naturalWidth, sourceHeight: probe.naturalHeight });
        }
      };
      probe.onerror = () => resolve({ error: true, x: 0, y: 0, width: 192, height: 192, sourceWidth: 192, sourceHeight: 192 });
      probe.src = source;
    });
    previewAlphaBounds.set(source, promise); return promise;
  }
  function alphaCropImage(source, targetWidth, targetHeight, crop = { x: 0, y: 0, width: targetWidth, height: targetHeight }) {
    return `<img class="layout-alpha-crop" src="${escapeHtml(source)}" alt="" data-alpha-source="${escapeHtml(source)}" data-target-width="${targetWidth}" data-target-height="${targetHeight}" data-crop-x="${crop.x}" data-crop-y="${crop.y}" data-crop-width="${crop.width}" data-crop-height="${crop.height}">`;
  }
  function hydrateLayoutAlphaCrops() {
    document.querySelectorAll('#layoutPreview .layout-alpha-crop').forEach((image) => {
      const source = image.dataset.alphaSource;
      previewAlphaBoundsFor(source).then((bounds) => {
        if (!image.isConnected || bounds.error) { if (bounds.error) image.parentElement.hidden = true; return; }
        const targetWidth = Number(image.dataset.targetWidth); const targetHeight = Number(image.dataset.targetHeight);
        const cropX = Number(image.dataset.cropX); const cropY = Number(image.dataset.cropY);
        const cropWidth = Math.max(1, Number(image.dataset.cropWidth)); const cropHeight = Math.max(1, Number(image.dataset.cropHeight));
        image.style.width = `${bounds.sourceWidth / Math.max(1, bounds.width) * targetWidth / cropWidth * 100}%`;
        image.style.height = `${bounds.sourceHeight / Math.max(1, bounds.height) * targetHeight / cropHeight * 100}%`;
        image.style.left = `${(-bounds.x / Math.max(1, bounds.width) * targetWidth - cropX) / cropWidth * 100}%`;
        image.style.top = `${(-bounds.y / Math.max(1, bounds.height) * targetHeight - cropY) / cropHeight * 100}%`;
        image.dataset.alphaCropped = 'true';
      });
    });
  }
  function fishHabitat(entry) {
    const fish = inventoryFish(entry);
    return entry.habitat || fish.habitat || (String(entry.pack || fish.pack || '').startsWith('S') ? 'saltwater' : 'freshwater');
  }
  function fishBioload(entry) {
    const declared = Number(entry.bioload ?? entry.aquariumBioload);
    if (Number.isFinite(declared) && declared > 0) return Math.min(4, Math.max(1, Math.round(declared)));
    const length = Number(entry.lengthCm) || 0;
    const explicitSize = entry.aquariumSizeClass || entry.visualSize;
    if (explicitSize === 'giant') return 4;
    if (explicitSize === 'large') return 3;
    if (explicitSize === 'small') return 2;
    if (/鳐|魟|蝠鲼/.test(String(entry.name || inventoryFish(entry).name || ''))) return length > 200 ? 4 : 3;
    return length > 200 ? 4 : length > 60 ? 3 : length > 15 ? 2 : 1;
  }
  function aquariumFishIds(tankIdOrHabitat) {
    return aquariumTank(tankIdOrHabitat).fish.map((item) => typeof item === 'string' ? item : item.inventoryId).filter(Boolean);
  }
  function aquariumMembershipInfo(inventoryId) {
    if (!aquariumEnabled()) return null;
    return aquariumTanks().find((tank) => tank.fish.some((entry) => (typeof entry === 'string' ? entry : entry.inventoryId) === inventoryId)) || null;
  }
  function aquariumMembership(inventoryId) { return aquariumMembershipInfo(inventoryId)?.habitat || null; }
  function habitatUnlocked(habitat) {
    if (habitat === 'freshwater') return true;
    const aquarium = aquariumData();
    if (aquarium.habitatsUnlocked && aquarium.habitatsUnlocked.saltwater != null) return Boolean(aquarium.habitatsUnlocked.saltwater);
    return (snapshot.state.ownedPacks || []).some((pack) => String(pack).startsWith('S'));
  }
  function aquariumUsage(tankIdOrHabitat) {
    const tank = aquariumTank(tankIdOrHabitat || aquariumData().activeTankId || aquariumHabitat);
    const ids = new Set(tank.fish.map((item) => typeof item === 'string' ? item : item.inventoryId).filter(Boolean));
    const entries = (snapshot.state.inventory || []).filter((entry) => ids.has(entry.inventoryId));
    return { count: entries.length, bioload: entries.reduce((sum, entry) => sum + fishBioload(entry), 0), entries, tank };
  }
  function aquariumSkinName(tankIdOrHabitat) {
    const tank = aquariumTank(tankIdOrHabitat);
    return aquariumItem(tank.skinId)?.name || tank.skinName || '基础玻璃缸';
  }
  function aquariumFishCard(entry, action, tankId = '') {
    const fish = inventoryFish(entry);
    const variant = normalizeVariant(entry.variant);
    const load = fishBioload(entry);
    const habitat = fishHabitat(entry);
    return `<article class="aquarium-fish-card rarity-${fish.rarity}" data-aquarium-inventory="${escapeHtml(entry.inventoryId)}" data-pack="${escapeHtml(entry.pack || fish.pack || '')}" data-rarity="${escapeHtml(entry.rarity || fish.rarity || 'common')}" data-variant="${variant}">
      ${fishFrame(fish, true, variant)}<div class="aquarium-fish-copy"><strong class="variant-text-${variant}">${escapeHtml(entry.name || fish.name)}</strong><small>${escapeHtml(entry.rarityName || fish.rarityName || '')} · ${VARIANT_NAMES[variant]}</small><small>${escapeHtml(entry.size || `${Number(entry.lengthCm || 0).toFixed(1)} cm`)} · ${escapeHtml(entry.weight || PondGame.formatWeight(entry.weightKg || 0))}</small><small>${HABITAT_NAMES[habitat]} · 负载 ${load}</small></div>
      <button class="pixel-button compact" data-action="${action}" data-inventory="${escapeHtml(entry.inventoryId)}" ${tankId ? `data-tank-id="${escapeHtml(tankId)}"` : ''} type="button">${action === 'aquarium-remove-fish' ? '移出' : '放入'}</button>
    </article>`;
  }
  function inventoryCard(entry) {
    const fish = inventoryFish(entry);
    const variant = normalizeVariant(entry.variant);
    const locked = Boolean(entry.locked);
    const selected = selectedInventoryIds.has(entry.inventoryId);
    const rarityName = entry.rarityName || snapshot.rarityNames[fish.rarity] || '';
    const sizeText = entry.size || `${Number(entry.lengthCm || 0).toFixed(1)} cm`;
    const weightText = entry.weight || PondGame.formatWeight(entry.weightKg || 0);
    const displayedTank = aquariumMembershipInfo(entry.inventoryId);
    const displayedHabitat = displayedTank?.habitat || null;
    return `<button class="inventory-card rarity-${fish.rarity} ${inventoryBulkMode ? 'bulk-selectable' : ''}" data-inventory="${escapeHtml(entry.inventoryId)}" data-pack="${escapeHtml(entry.pack || fish.pack || '')}" data-rarity="${escapeHtml(entry.rarity || fish.rarity || 'common')}" data-variant="${variant}" type="button" aria-pressed="${inventoryBulkMode ? String(selected) : 'false'}">
      <span class="inventory-card-head"><span class="inventory-rarity">${escapeHtml(rarityName)}</span><span class="inventory-value ${Number(entry.valueCoins) >= 1000 ? 'inventory-value-wide' : ''}" title="${escapeHtml(coinText(entry.valueCoins))}">${escapeHtml(coinText(entry.valueCoins))}</span></span>${locked ? '<span class="lock-corner" title="受保护，需解锁后出售">锁</span>' : ''}
      ${displayedTank ? `<span class="aquarium-corner" title="正在${escapeHtml(displayedTank.name)}展示">缸</span>` : ''}
      ${inventoryBulkMode ? `<span class="inventory-check ${selected ? 'selected' : ''}" aria-hidden="true">${selected ? '✓' : ''}</span>` : ''}
      ${fishFrame(fish, true, variant)}
      <strong class="card-name variant-text-${variant}">${escapeHtml(entry.name || fish.name)}</strong>
      <small class="inventory-measure">${escapeHtml(sizeText)} · ${escapeHtml(weightText)}</small>
      <small class="inventory-variant"><strong class="variant-text-${variant}">${VARIANT_NAMES[variant]}</strong></small>
    </button>`;
  }
  function renderWarehouse() {
    const liveIds = new Set((snapshot.state.inventory || []).map((entry) => entry.inventoryId));
    for (const id of selectedInventoryIds) if (!liveIds.has(id)) selectedInventoryIds.delete(id);
    const allInventory = snapshot.state.inventory || [];
    const inventory = allInventory.filter((entry) => listMatches(entry, 'warehouse') && (!aquariumEnabled() || (inventoryDisplayFilter === 'displayed' ? Boolean(aquariumMembership(entry.inventoryId)) : inventoryDisplayFilter === 'available' ? !aquariumMembership(entry.inventoryId) : true))).sort((left, right) => compareListRecords(left, right, listUi.warehouse.mode, listUi.warehouse.direction));
    const cards = inventory.map(inventoryCard).join('');
    const selectedEntries = inventory.filter((entry) => selectedInventoryIds.has(entry.inventoryId));
    const selectedValue = selectedEntries.reduce((sum, entry) => sum + (Number(entry.valueCoins) || 0), 0);
    const displayFilter = aquariumEnabled() ? `<label class="display-filter">展示 <select id="inventoryDisplayFilter"><option value="all" ${inventoryDisplayFilter === 'all' ? 'selected' : ''}>全部</option><option value="available" ${inventoryDisplayFilter === 'available' ? 'selected' : ''}>未展示</option><option value="displayed" ${inventoryDisplayFilter === 'displayed' ? 'selected' : ''}>展示中</option></select></label>` : '';
    const warehouseTrailing = `${displayFilter}<button class="pixel-button compact ${inventoryBulkMode ? 'active' : ''}" data-action="toggle-bulk" type="button">${inventoryBulkMode ? '退出批量' : '批量卖出'}</button>`;
    return `${header('鱼类仓库', `显示 ${inventory.length} / ${allInventory.length} 条`, `<strong class="page-balance">${escapeHtml(coinText(snapshot.state.wallet?.balance))}</strong>`)}
      ${listToolbar('warehouse', { trailing: warehouseTrailing })}
      ${cards ? `<section class="inventory-grid">${cards}</section>` : empty('仓库还是空的。钓上来的鱼会自动放在这里。')}
      ${inventoryBulkMode && inventory.length ? `<div class="bulk-sale-bar"><span>已选 ${selectedEntries.length} 条 · ${escapeHtml(coinText(selectedValue))}</span><button class="pixel-button" data-action="confirm-bulk-sale" type="button" ${selectedEntries.length ? '' : 'disabled'}>出售已选</button></div>` : ''}`;
  }
  function renderInventoryDetail(inventoryId) {
    const entry = (snapshot.state.inventory || []).find((item) => item.inventoryId === inventoryId);
    if (!entry) return `${header('鱼获详情')}${empty('这条鱼已经不在仓库中。')}`;
    const fish = inventoryFish(entry);
    const variant = normalizeVariant(entry.variant); const locked = Boolean(entry.locked);
    const displayedTank = aquariumMembershipInfo(entry.inventoryId);
    const displayedHabitat = displayedTank?.habitat || null;
    const lockButton = `<button class="pixel-button" data-action="toggle-lock" data-inventory="${escapeHtml(entry.inventoryId)}" data-locked="${locked ? 'true' : 'false'}" type="button">${locked ? '解锁鱼获' : '锁定鱼获'}</button>`;
    const aquariumButton = aquariumEnabled() ? `<button class="pixel-button aquarium-action" data-action="${displayedTank ? 'aquarium-remove-fish' : 'aquarium-place-fish'}" data-inventory="${escapeHtml(entry.inventoryId)}" ${displayedTank ? `data-tank-id="${escapeHtml(displayedTank.tankId)}"` : ''} type="button">${displayedTank ? `从${escapeHtml(displayedTank.name)}移出` : '放入鱼缸'}</button>` : '';
    const saleDisabled = locked || Boolean(displayedTank);
    const aquariumFact = aquariumEnabled() ? fact('鱼缸负载', String(fishBioload(entry))) : '';
    return `${header(entry.name || fish.name, `${entry.packName || fish.packName} · ${entry.rarityName || fish.rarityName}`)}<article class="detail-card rarity-${fish.rarity}"><div class="detail-hero">${fishFrame(fish, true, variant)}<div><h2>${escapeHtml(entry.name || fish.name)}</h2><p class="rarity-label">${escapeHtml(entry.rarityName || fish.rarityName)} · ${escapeHtml(entry.packName || fish.packName)} · ${VARIANT_NAMES[variant]}</p><p class="inventory-price-large">${escapeHtml(coinText(entry.valueCoins))}</p>${locked ? '<p class="protected-note">★ 稀有鱼获已保护，解锁后才可出售</p>' : ''}${displayedTank ? `<p class="aquarium-note">▣ 正在${escapeHtml(displayedTank.name)}展示，需先移出才能出售</p>` : ''}</div></div><div class="facts">${fact('长度', entry.size || `${Number(entry.lengthCm).toFixed(1)} cm`)}${fact('重量', entry.weight || PondGame.formatWeight(entry.weightKg))}${fact('捕获时间', dateText(entry.caughtAt || entry.at))}${fact('状态', displayedTank ? `${displayedTank.name}展示中` : locked ? '已保护' : '在仓库中')}${aquariumFact}</div><div class="detail-actions">${aquariumButton}${lockButton}<button class="pixel-button danger" data-action="sell-detail" data-inventory="${escapeHtml(entry.inventoryId)}" type="button" ${saleDisabled ? `disabled title="${displayedTank ? '请先从鱼缸移出' : '请先解锁该鱼获'}"` : ''}>${displayedTank ? '展示中' : locked ? '已保护' : '出售这条鱼'}</button></div></article>`;
  }
  function packDefinition(packId) {
    return PondGame.PACK_DEFINITIONS?.[packId] || {
      id: packId, name: snapshot.packs[packId] || packId,
      habitat: String(packId).startsWith('S') ? 'saltwater' : 'freshwater',
      starter: packId === 'F1', priceCoins: PondGame.getPackPrice(packId) || 0,
      prerequisitePack: PondGame.PACK_PREREQUISITES?.[packId] || null
    };
  }
  function habitatTabs(active, action = 'aquarium-tank-habitat', tankId = '') {
    return `<div class="pixel-tabs habitat-tabs" role="tablist" aria-label="鱼缸水域"><button class="pixel-button ${active === 'freshwater' ? 'active' : ''}" data-action="${action}" data-habitat="freshwater" data-tank-id="${escapeHtml(tankId)}" role="tab" aria-selected="${active === 'freshwater'}" type="button">淡水</button><button class="pixel-button ${active === 'saltwater' ? 'active' : ''}" data-action="${action}" data-habitat="saltwater" data-tank-id="${escapeHtml(tankId)}" role="tab" aria-selected="${active === 'saltwater'}" type="button" ${habitatUnlocked('saltwater') ? '' : 'disabled title="拥有任意咸水鱼包后解锁"'}>咸水${habitatUnlocked('saltwater') ? '' : ' · 未解锁'}</button></div>`;
  }
  function renderAquarium() {
    const aquarium = aquariumData();
    const tanks = aquariumTanks();
    const tank = aquariumTank(aquarium.activeTankId || tanks[0]?.tankId);
    aquariumHabitat = tank.habitat || 'freshwater';
    const usage = aquariumUsage(tank.tankId);
    const displayedIds = new Set(aquariumFishIds(tank.tankId));
    const allDisplayed = new Set(tanks.flatMap((entry) => entry.fish.map((fish) => typeof fish === 'string' ? fish : fish.inventoryId)));
    const available = (snapshot.state.inventory || []).filter((entry) => fishHabitat(entry) === tank.habitat && !allDisplayed.has(entry.inventoryId) && listMatches(entry, 'aquarium')).sort((left, right) => compareListRecords(left, right, listUi.aquarium.mode, listUi.aquarium.direction));
    const tankCards = tanks.map((entry) => { const stats = aquariumUsage(entry.tankId); const selected = entry.tankId === tank.tankId; return `<button class="aquarium-instance-card ${selected ? 'active' : ''}" data-action="aquarium-select-tank" data-tank-id="${escapeHtml(entry.tankId)}" type="button" aria-pressed="${selected}"><img src="${escapeHtml(itemAsset(aquariumItem(entry.skinId)))}" alt=""><span><strong>${escapeHtml(entry.name)}</strong><small>${HABITAT_NAMES[entry.habitat]} · ${stats.count}/8 条 · ${stats.bioload}/12</small></span></button>`; }).join('');
    return `${header('桌面鱼缸', '逐缸收藏、展示与布置')}
      <section class="aquarium-instance-strip" aria-label="所有桌面鱼缸">${tankCards || empty('尚未拥有桌面鱼缸。请前往商店新增鱼缸。')}</section>
      <section class="aquarium-summary"><div><strong>${escapeHtml(tank.name || '鱼缸1')}</strong><small>${escapeHtml(aquariumSkinName(tank.tankId))}</small></div><div>${habitatTabs(tank.habitat, 'aquarium-tank-habitat', tank.tankId)}</div><div class="capacity-meter"><span>鱼数 <b>${usage.count}/8</b></span><progress max="8" value="${usage.count}"></progress></div><div class="capacity-meter"><span>负载 <b>${usage.bioload}/12</b></span><progress max="12" value="${usage.bioload}"></progress></div><div class="aquarium-summary-actions"><button class="pixel-button compact" data-action="aquarium-toggle-window" type="button">${aquarium.visible ? '隐藏鱼缸' : '显示鱼缸'}</button><button class="pixel-button compact" data-page="aquarium-layout" data-tank-id="${escapeHtml(tank.tankId)}" type="button">布置此缸</button></div></section>
      <section class="aquarium-manager-grid"><div><h2>已展示 <small>${usage.count}/8</small></h2><div class="aquarium-fish-list">${usage.entries.length ? usage.entries.map((entry) => aquariumFishCard(entry, 'aquarium-remove-fish', tank.tankId)).join('') : empty('这个鱼缸还是空的。')}</div></div><div><h2>可放入库存 <small>${available.length} 条</small></h2>${listToolbar('aquarium')}<div class="aquarium-fish-list">${available.length ? available.map((entry) => aquariumFishCard(entry, 'aquarium-place-fish', tank.tankId)).join('') : empty(`没有符合条件的${HABITAT_NAMES[tank.habitat]}库存鱼。`)}</div></div></section>
      ${displayedIds.size !== tank.fish.length ? '<p class="aquarium-warning">检测到无效展示引用；状态层会安全清理，不会生成替代鱼。</p>' : ''}`;
  }
  function storeCategoryOptions(selected) {
    const categories = [...new Set(aquariumCatalog().map(itemCategory))];
    return categories.map((category) => `<option value="${escapeHtml(category)}" ${selected === category ? 'selected' : ''}>${escapeHtml(AQUARIUM_CATEGORY_NAMES[category] || category)}</option>`).join('');
  }
  function renderAquariumShop(balance) {
    const owned = new Set(aquariumData().ownedItemIds);
    const items = aquariumCatalog().filter((item) => {
      const habitat = item.habitat || 'both';
      const itemOwned = itemCategory(item) === 'tank' ? aquariumTanks().some((tank) => tank.skinId === itemIdOf(item)) : owned.has(itemIdOf(item));
      return (aquariumShopHabitat === 'all' || habitat === 'both' || habitat === aquariumShopHabitat)
        && (aquariumShopCategory === 'all' || itemCategory(item) === aquariumShopCategory)
        && (aquariumShopOwned === 'all' || (aquariumShopOwned === 'owned') === itemOwned);
    });
    const cards = items.map((item) => {
      const id = itemIdOf(item); const isTank = itemCategory(item) === 'tank'; const tankCount = aquariumTanks().filter((tank) => tank.skinId === id).length; const itemOwned = isTank ? tankCount > 0 : owned.has(id); const price = itemPrice(item);
      const habitat = item.habitat || 'both'; const habitatText = habitat === 'both' ? '淡水/咸水' : HABITAT_NAMES[habitat] || habitat;
      const canUseHabitat = habitat !== 'saltwater' || habitatUnlocked('saltwater'); const canBuy = balance >= price && canUseHabitat && price > 0;
      const buyLabel = !canUseHabitat ? '需咸水鱼包' : balance >= price ? '购买' : '金币不足';
      const layoutHabitat = habitat === 'both' ? aquariumData().activeHabitat : habitat;
      const action = isTank
        ? `<button class="pixel-button compact" data-action="aquarium-buy-item" data-item="${escapeHtml(id)}" type="button" ${canBuy ? '' : `disabled title="${!canUseHabitat ? '拥有任意咸水鱼包后可新增' : '金币不足，购买失败不会扣款'}"`}>新增鱼缸</button>`
        : itemOwned ? `<button class="pixel-button compact" data-page="aquarium-layout" data-tank-id="${escapeHtml(aquariumTank(layoutHabitat).tankId)}" type="button">去布置</button>` : `<button class="pixel-button compact" data-action="aquarium-buy-item" data-item="${escapeHtml(id)}" type="button" ${canBuy ? '' : `disabled title="${!canUseHabitat ? '拥有任意咸水鱼包后可购买' : '金币不足，购买失败不会扣款'}"`}>${buyLabel}</button>`;
      return `<article class="aquarium-shop-card ${itemOwned ? 'owned' : ''}"><button class="aquarium-shop-preview" data-action="aquarium-item-detail" data-item="${escapeHtml(id)}" type="button"><img src="${escapeHtml(itemAsset(item))}" alt="${escapeHtml(item.name)}" onerror="this.src='../assets/ui/icons/aquarium.svg'"></button><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(habitatText)} · ${escapeHtml(AQUARIUM_CATEGORY_NAMES[itemCategory(item)] || itemCategory(item))}</small><b>${isTank ? `${tankCount ? `已有 ${tankCount} 个 · ` : ''}${escapeHtml(coinText(price))}` : itemOwned ? '已拥有' : escapeHtml(coinText(price))}</b>${action}</article>`;
    }).join('');
    return `<div class="aquarium-shop-filters"><label>水域 <select id="aquariumShopHabitat"><option value="all">全部</option><option value="freshwater" ${aquariumShopHabitat === 'freshwater' ? 'selected' : ''}>淡水</option><option value="saltwater" ${aquariumShopHabitat === 'saltwater' ? 'selected' : ''}>咸水</option></select></label><label>类别 <select id="aquariumShopCategory"><option value="all">全部类别</option>${storeCategoryOptions(aquariumShopCategory)}</select></label><label>拥有 <select id="aquariumShopOwned"><option value="all">全部</option><option value="owned" ${aquariumShopOwned === 'owned' ? 'selected' : ''}>已拥有</option><option value="unowned" ${aquariumShopOwned === 'unowned' ? 'selected' : ''}>未拥有</option></select></label></div>${cards ? `<section class="aquarium-shop-grid">${cards}</section>` : empty('没有符合筛选条件的装饰。')}`;
  }
  function renderShop() {
    const owned = new Set(snapshot.state.ownedPacks || ['F1']);
    const equipment = snapshot.state.equipment || { ownedIds: [], activeBaitId: null };
    const ownedEquipment = new Set(equipment.ownedIds || []);
    const balance = Number(snapshot.state.wallet?.balance) || 0;
    const packs = CATALOG_PACK_ORDER.map((packId) => {
      const definition = packDefinition(packId);
      const isOwned = owned.has(packId);
      const affordable = balance >= definition.priceCoins;
      const requiredPack = definition.prerequisitePack;
      const missingPrerequisite = !isOwned && requiredPack && !owned.has(requiredPack);
      const habitatName = definition.habitat === 'saltwater' ? '咸水' : '淡水';
      const prerequisiteName = requiredPack ? (snapshot.packs[requiredPack] || requiredPack) : '';
      const note = isOwned ? '已加入对应垂钓池' : missingPrerequisite ? `需先解锁 ${prerequisiteName}` : `${habitatName}鱼包 · 38 种鱼`;
      const buyLabel = missingPrerequisite ? `需先解锁 ${prerequisiteName}` : affordable ? '购买' : '金币不足';
      return `<article class="shop-card ${isOwned ? 'owned' : ''} ${missingPrerequisite ? 'prerequisite-locked' : ''}"><div class="shop-icon-frame"><img src="../assets/ui/icons/${definition.habitat}.svg" alt="${escapeHtml(definition.name)}"></div><h3>${escapeHtml(definition.name)}</h3><strong class="shop-price">${isOwned ? '已拥有' : escapeHtml(coinText(definition.priceCoins))}</strong><p>${escapeHtml(note)}</p>${!isOwned && definition.habitat === 'saltwater' ? '<small>按 F1 → F2 → S1 → S2 顺序解锁</small>' : ''}<div class="shop-action">${isOwned ? '<span class="owned-mark" aria-label="已拥有">✓</span>' : `<button class="pixel-button compact" data-buy-pack="${packId}" type="button" ${affordable && !missingPrerequisite ? '' : 'disabled'}>${escapeHtml(buyLabel)}</button>`}</div></article>`;
    }).join('');
    const equipmentCards = (PondGame.EQUIPMENT_ORDER || []).map((equipmentId) => {
      const definition = PondGame.EQUIPMENT_DEFINITIONS[equipmentId];
      const isOwned = ownedEquipment.has(equipmentId);
      const isActive = definition.type === 'bait' && equipment.activeBaitId === equipmentId;
      const missingPrerequisite = !isOwned && definition.prerequisiteId && !ownedEquipment.has(definition.prerequisiteId);
      const prerequisiteName = definition.prerequisiteId ? PondGame.EQUIPMENT_DEFINITIONS[definition.prerequisiteId]?.name : '';
      const affordable = balance >= definition.priceCoins;
      const buyLabel = missingPrerequisite ? `需先购买${prerequisiteName}` : affordable ? '购买' : '金币不足';
      const action = !isOwned
        ? `<button class="pixel-button compact" data-buy-equipment="${escapeHtml(equipmentId)}" type="button" ${affordable && !missingPrerequisite ? '' : 'disabled'}>${escapeHtml(buyLabel)}</button>`
        : definition.type === 'bait'
          ? `<button class="pixel-button compact ${isActive ? 'active' : ''}" data-equip-bait="${escapeHtml(equipmentId)}" type="button" ${isActive ? 'disabled' : ''}>${isActive ? '使用中' : '使用'}</button>`
          : '<span class="owned-mark" aria-label="已拥有">✓</span>';
      return `<article class="shop-card equipment-card ${isOwned ? 'owned' : ''} ${isActive ? 'equipped' : ''} ${missingPrerequisite ? 'prerequisite-locked' : ''}"><div class="shop-icon-frame"><img src="../assets/ui/icons/${escapeHtml(definition.icon)}" alt="${escapeHtml(definition.name)}"></div><h3>${escapeHtml(definition.name)}</h3><strong class="shop-price">${isOwned ? (isActive ? '已装备' : '已拥有') : escapeHtml(coinText(definition.priceCoins))}</strong><p>${escapeHtml(missingPrerequisite ? `需先购买${prerequisiteName}` : definition.description)}</p><div class="shop-action">${action}</div></article>`;
    }).join('');
    const noBait = (PondGame.BAIT_ORDER || []).some((id) => ownedEquipment.has(id))
      ? `<button class="pixel-button compact ${equipment.activeBaitId ? '' : 'active'}" data-equip-bait="" type="button" ${equipment.activeBaitId ? '' : 'disabled'}>不使用钓饵${equipment.activeBaitId ? '' : ' · 当前'}</button>` : '';
    const coreShop = `<section class="shop-section" aria-labelledby="shopPacksTitle"><div class="shop-section-heading"><h2 id="shopPacksTitle">鱼包</h2><small>永久扩展淡水与咸水鱼池</small></div><div class="shop-grid">${packs}</div></section><section class="shop-section" aria-labelledby="shopEquipmentTitle"><div class="shop-section-heading"><div><h2 id="shopEquipmentTitle">装备</h2><small>永久解锁；同一时间只使用一种钓饵</small></div>${noBait}</div><div class="shop-grid">${equipmentCards}</div></section>`;
    if (!aquariumEnabled()) return `${header('商店', '鱼包与装备均为永久解锁，购买失败不会扣款')}<div class="shop-balance">当前余额 <strong>${escapeHtml(coinText(balance))}</strong></div>${coreShop}`;
    return `${header('商店', '所有商品永久解锁，失败不会扣款')}<div class="shop-header"><div class="pixel-tabs" role="tablist"><button class="pixel-button ${shopTab === 'packs' ? 'active' : ''}" data-action="shop-tab" data-tab="packs" type="button">钓鱼商品</button><button class="pixel-button ${shopTab === 'aquarium' ? 'active' : ''}" data-action="shop-tab" data-tab="aquarium" type="button">鱼缸装饰</button></div><div class="shop-balance">当前余额 <strong>${escapeHtml(coinText(balance))}</strong></div></div>${shopTab === 'packs' ? coreShop : renderAquariumShop(balance)}`;
  }
  function cloneLayout(value) { return JSON.parse(JSON.stringify(value)); }
  function defaultLayout(tankId) {
    const tank = aquariumTank(tankId); const habitat = tank.habitat || 'freshwater';
    return { tankId: tank.tankId, habitat, skinId: tank.skinId || 'tank-basic', backgroundId: tank.backgroundId || null, substrateId: tank.substrateId ?? (habitat === 'freshwater' ? 'substrate-river-sand' : null), effectId: tank.effectId || null, decor: cloneLayout(tank.decor || []) };
  }
  function catalogDefaultLayout(habitat) {
    const source = aquariumCatalogData()?.defaultLayouts?.[habitat];
    return source ? { habitat, ...cloneLayout(source) } : { habitat, skinId: 'tank-basic', backgroundId: null, substrateId: habitat === 'freshwater' ? 'substrate-river-sand' : null, effectId: null, decor: [] };
  }
  function ensureLayoutDraft(tankId) {
    if (!layoutDraft || layoutDraft.tankId !== tankId) {
      layoutDraft = defaultLayout(tankId);
      layoutUndo = [];
      layoutRedo = [];
      selectedDecorInstanceId = null;
    }
    return layoutDraft;
  }
  function pushLayoutHistory() {
    if (!layoutDraft) return;
    layoutUndo.push(cloneLayout(layoutDraft));
    if (layoutUndo.length > 30) layoutUndo.shift();
    layoutRedo = [];
  }
  function decorCost(decor) {
    const item = aquariumItem(decor.itemId);
    return Math.max(1, Math.min(3, Math.round(Number(item?.load ?? item?.capacityCost ?? item?.cost ?? 1) || 1)));
  }
  function layoutStatus(draft) {
    const decor = draft.decor || [];
    const cost = decor.reduce((sum, item) => sum + decorCost(item), 0);
    const counts = decor.reduce((map, item) => map.set(item.itemId, (map.get(item.itemId) || 0) + 1), new Map());
    const invalidScale = decor.some((placement) => !Number.isFinite(Number(placement.scale)) || Number(placement.scale) < .5 || Number(placement.scale) > 2);
    const outOfBounds = decor.some((placement) => {
      const item = aquariumItem(placement.itemId); const footprint = item?.footprint || {}; const scale = Number(placement.scale) || 1;
      const width = Math.max(0, Number(footprint.width) || 0) * scale; const height = Math.max(0, Number(footprint.height) || 0) * scale;
      const x = Number(placement.x) * 448; const y = Number(placement.y) * 192;
      return !Number.isFinite(x) || !Number.isFinite(y) || x - width / 2 < 0 || x + width / 2 > 448 || y - height < 0 || y > 192;
    });
    const overCoverage = decor.reduce((sum, placement) => {
      const item = aquariumItem(placement.itemId); if (!item?.opaque) return sum;
      const footprint = item.footprint || {}; const scale = Number(placement.scale) || 1;
      return sum + Math.max(0, Number(footprint.width) || 0) * Math.max(0, Number(footprint.height) || 0) * scale * scale / (448 * 192);
    }, 0) > .38;
    const valid = decor.length <= 8 && cost <= 12 && ![...counts.values()].some((count) => count > 3) && !invalidScale && !outOfBounds && !overCoverage;
    return { valid, cost, count: decor.length, reason: invalidScale ? '装饰大小需在 50%–200% 之间' : outOfBounds ? '装饰超出水体安全区' : decor.length > 8 ? '自由装饰超过 8 个' : cost > 12 ? '装饰负载超过 12 点' : [...counts.values()].some((count) => count > 3) ? '同一装饰最多放置 3 份' : overCoverage ? '硬景覆盖超过可见水体 38%' : '' };
  }
  function fixedSlotSelect(label, slot, categories, selected, habitat, owned, allowNone = true) {
    const options = aquariumCatalog().filter((item) => categories.includes(itemCategory(item)) && owned.has(itemIdOf(item)) && ((item.habitat || 'both') === 'both' || item.habitat === habitat));
    return `<label>${label}<select data-layout-slot="${slot}">${allowNone ? '<option value="">无</option>' : ''}${options.map((item) => `<option value="${escapeHtml(itemIdOf(item))}" ${selected === itemIdOf(item) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>`;
  }
  function fixedPreviewMarkup(item, kind) {
    if (!item) return '';
    const height = kind === 'substrate' ? AQUARIUM_WATER.substrateHeight : AQUARIUM_WATER.height;
    return `<span class="layout-preview-fixed layout-preview-${kind}" data-preview-fixed-kind="${kind}" data-item-id="${escapeHtml(itemIdOf(item))}">${alphaCropImage(itemAsset(item), AQUARIUM_WATER.width, height)}</span>`;
  }
  function skinPreviewMarkup(item) {
    if (!item) return '';
    const slices = {
      top: { x: 0, y: 0, width: AQUARIUM_BASE.width, height: AQUARIUM_WATER.y },
      bottom: { x: 0, y: AQUARIUM_WATER.y + AQUARIUM_WATER.height, width: AQUARIUM_BASE.width, height: AQUARIUM_BASE.height - AQUARIUM_WATER.y - AQUARIUM_WATER.height },
      left: { x: 0, y: AQUARIUM_WATER.y, width: AQUARIUM_WATER.x, height: AQUARIUM_WATER.height },
      right: { x: AQUARIUM_WATER.x + AQUARIUM_WATER.width, y: AQUARIUM_WATER.y, width: AQUARIUM_BASE.width - AQUARIUM_WATER.x - AQUARIUM_WATER.width, height: AQUARIUM_WATER.height }
    };
    const source = itemAsset(item);
    return `<span class="layout-preview-skin" data-preview-fixed-kind="skin" data-item-id="${escapeHtml(itemIdOf(item))}">${Object.entries(slices).map(([position, rect]) => `<span class="layout-preview-skin-slice skin-${position}" data-skin-slice="${position}" style="left:${rect.x / AQUARIUM_BASE.width * 100}%;top:${rect.y / AQUARIUM_BASE.height * 100}%;width:${rect.width / AQUARIUM_BASE.width * 100}%;height:${rect.height / AQUARIUM_BASE.height * 100}%">${alphaCropImage(source, AQUARIUM_BASE.width, AQUARIUM_BASE.height, rect)}</span>`).join('')}</span>`;
  }
  function renderAquariumLayout(tankId) {
    const tank = aquariumTank(tankId || aquariumData().activeTankId); const habitat = tank.habitat || 'freshwater';
    aquariumHabitat = habitat;
    const draft = ensureLayoutDraft(tank.tankId);
    const owned = new Set(aquariumData().ownedItemIds);
    const status = layoutStatus(draft);
    const freeItems = aquariumCatalog().filter((item) => !['tank', 'skin', 'background', 'substrate', 'effect'].includes(itemCategory(item)) && owned.has(itemIdOf(item)) && ((item.habitat || 'both') === 'both' || item.habitat === habitat));
    const placed = (draft.decor || []).map((placement) => {
      const item = aquariumItem(placement.itemId) || { name: placement.itemId };
      const x = Math.max(0, Math.min(1, Number(placement.x) || 0)); const y = Math.max(0, Math.min(1, Number(placement.y) || 0));
      const footprint = item.footprint || {}; const width = Math.max(20, Number(footprint.width) || 52); const height = Math.max(16, Number(footprint.height) || 52);
      return `<button class="layout-placement ${selectedDecorInstanceId === placement.instanceId ? 'selected' : ''}" data-decor-instance="${escapeHtml(placement.instanceId)}" type="button" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%;width:${(width / AQUARIUM_WATER.width * 100).toFixed(2)}%;height:${(height / AQUARIUM_WATER.height * 100).toFixed(2)}%;--decor-scale:${Number(placement.scale) || 1};--decor-flip:${placement.flipX ? -1 : 1}" title="${escapeHtml(item.name)}">${alphaCropImage(itemAsset(item), width, height)}</button>`;
    }).join('');
    const selected = (draft.decor || []).find((item) => item.instanceId === selectedDecorInstanceId);
    const fixedPreview = [
      fixedPreviewMarkup(aquariumItem(draft.backgroundId), 'background'),
      fixedPreviewMarkup(aquariumItem(draft.substrateId), 'substrate'),
      fixedPreviewMarkup(aquariumItem(draft.effectId), 'effect')
    ].join('');
    const skinPreview = skinPreviewMarkup(aquariumItem(draft.skinId));
    return `${header('布置桌面鱼缸', `${escapeHtml(tank.name)} · ${HABITAT_NAMES[habitat]} · 4 DIP 网格`)}
      <section class="layout-fixed-slots"><label>鱼缸款式<strong class="fixed-tank-skin">${escapeHtml(aquariumSkinName(tank.tankId))}</strong></label>${fixedSlotSelect('背景', 'backgroundId', ['background'], draft.backgroundId, habitat, owned)}${fixedSlotSelect('底砂', 'substrateId', ['substrate'], draft.substrateId, habitat, owned)}${fixedSlotSelect('轻效果', 'effectId', ['effect'], draft.effectId, habitat, owned)}</section>
      <section class="layout-workspace"><aside><h2>已拥有装饰</h2><div class="layout-palette">${freeItems.length ? freeItems.map((item) => `<button class="layout-palette-item" data-action="layout-add" data-item="${escapeHtml(itemIdOf(item))}" type="button"><img src="${escapeHtml(itemAsset(item))}" alt=""><span>${escapeHtml(item.name)}</span><small>${decorCost({ itemId: itemIdOf(item) })} 点</small></button>`).join('') : '<p class="muted">尚未拥有自由装饰，可前往商店购买。</p>'}</div></aside><div><div class="layout-tank-preview ${status.valid ? '' : 'invalid'}" id="layoutPreview" aria-label="鱼缸布置预览"><div class="layout-water-preview" id="layoutWaterPreview">${fixedPreview}${placed || '<span class="layout-empty-hint">点击左侧装饰放入鱼缸</span>'}</div>${skinPreview}</div><p class="layout-help">拖动装饰时按 4 DIP 网格吸附；红框表示当前布局不能保存。</p></div></section>
      <section class="layout-controls"><div><strong>自由装饰 ${status.count}/8 · 负载 ${status.cost}/12</strong>${status.reason ? `<small class="layout-error">${escapeHtml(status.reason)}</small>` : '<small>装饰不会改变钓鱼概率或收益</small>'}</div><div class="layout-toolbar"><button class="pixel-button compact" data-action="layout-undo" type="button" ${layoutUndo.length ? '' : 'disabled'}>撤销</button><button class="pixel-button compact" data-action="layout-redo" type="button" ${layoutRedo.length ? '' : 'disabled'}>重做</button><button class="pixel-button compact" data-action="layout-default" type="button">恢复默认</button>${selected ? `<button class="pixel-button compact" data-action="layout-flip" type="button">水平翻转</button><label class="decor-scale-control">大小 <input id="decorScale" type="range" min="0.5" max="2" step="0.05" value="${Math.max(.5, Math.min(2, Number(selected.scale) || 1))}"><output id="decorScaleValue">${Math.round((Number(selected.scale) || 1) * 100)}%</output></label><button class="pixel-button compact" data-action="layout-scale-step" data-scale-delta="-0.05" type="button" aria-label="缩小装饰">−</button><button class="pixel-button compact" data-action="layout-scale-step" data-scale-delta="0.05" type="button" aria-label="放大装饰">＋</button><button class="pixel-button compact danger" data-action="layout-remove" type="button">移除</button>` : ''}<button class="pixel-button" data-action="layout-cancel" type="button">取消</button><button class="pixel-button" data-action="layout-save" type="button" ${status.valid ? '' : 'disabled'}>保存布置</button></div></section>`;
  }
  PondAchievementPanel.configure({
    snapshot: () => snapshot,
    update: value => { snapshot = value; },
    refresh: reset => { if (reset) currentRoute().scrollTop = 0; else currentRoute().scrollTop = $('app').scrollTop; render(); },
    toast, dateText
  });
  function renderAchievements() {
    return header('成就', '每一份发现，都值得留下') + PondAchievementPanel.render();
  }
  function renderSpecialEvents() {
    const collection = snapshot.state.specialEventCollection?.entries || {};
    const cards = SPECIAL_SERIES.map((series) => {
      const found = specialEntries(series.id).filter((item) => item.discovered).length;
      const percent = series.total ? found / series.total * 100 : 0;
      return `<button class="special-series-card" data-page="special-event-detail" data-series-id="${series.id}" type="button"><img src="${series.icon}" alt=""><span><strong>${escapeHtml(series.name)}</strong><small>已发现 ${found}/${series.total}</small><i class="progress-track"><em style="width:${percent}%"></em></i></span></button>`;
    }).join('');
    return `${header('特殊事件', '三组收藏，重复获得不增加进度')}<section class="special-series-grid">${cards}</section>`;
  }
  function renderSpecialEventDetail(seriesId) {
    const series = SPECIAL_SERIES_BY_ID[seriesId] || SPECIAL_SERIES[0];
    const entries = specialEntries(series.id);
    const found = entries.filter((item) => item.discovered).length;
    const rows = entries.map((item) => item.discovered
      ? `<article class="special-entry discovered"><img src="${escapeHtml(item.iconPath ? rootAsset(item.iconPath) : series.icon)}" alt=""><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description || '已发现特殊事件。')}</p><small>首次发现：${escapeHtml(dateText(item.record.firstFoundAt || item.record.firstAt))}</small></div><b>×${Math.max(1, Number(item.record.count) || 1)}</b></article>`
      : `<article class="special-entry undiscovered"><img src="${series.icon}" alt=""><div><strong>尚未发现</strong><p>尚未发现</p></div></article>`).join('');
    return `${header(series.name, `已发现 ${found}/${series.total}`)}<div class="progress-track special-detail-progress"><em style="width:${found / series.total * 100}%"></em></div><section class="special-entry-list">${rows}</section>`;
  }
  function showAchievement(id) {
    PondAchievementPanel.show(id);
  }
  function renderHistory() {
    const { pack, rarity, query, sort } = filters.history;
    let list = snapshot.state.history.filter((entry) => (!pack || entry.pack === pack) && (!rarity || entry.rarity === rarity) && (!query || entry.name.includes(query)));
    list = [...list].sort(sort === 'length' ? (a, b) => b.lengthCm - a.lengthCm : sort === 'weight' ? (a, b) => b.weightKg - a.weightKg : sort === 'oldest' ? (a, b) => a.at - b.at : (a, b) => b.at - a.at);
    const rows = list.map((entry) => {
      const fish = snapshot.catalog.find((item) => item.id === entry.resultId);
      const variant = normalizeVariant(entry.variant);
      return `<button class="history-row rarity-${entry.rarity}" data-catch="${escapeHtml(entry.catchId)}" type="button">${fishFrame(fish || { id: entry.resultId, name: entry.name }, true, variant)}<span><strong>${escapeHtml(entry.name)} <em class="rarity-label">${escapeHtml(entry.rarityName)} · ${VARIANT_NAMES[variant]}</em></strong><small>${escapeHtml(entry.packName)} · ${escapeHtml(entry.size)} · ${escapeHtml(entry.weight)}</small></span><time>${escapeHtml(dateText(entry.at))}</time></button>`;
    }).join('');
    return `${header('历史收获', `保留最近 ${snapshot.state.history.length} / ${PondGame.HISTORY_LIMIT} 条`)}<div class="filter-row history-filters"><select id="historyPack"><option value="">全部鱼包</option>${optionList(snapshot.packs, pack)}</select><select id="historyRarity"><option value="">全部稀有度</option>${optionList(snapshot.rarityNames, rarity)}</select><input id="historyQuery" value="${escapeHtml(query)}" placeholder="搜索鱼名"><select id="historySort"><option value="newest" ${sort === 'newest' ? 'selected' : ''}>最新优先</option><option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>最早优先</option><option value="length" ${sort === 'length' ? 'selected' : ''}>长度纪录</option><option value="weight" ${sort === 'weight' ? 'selected' : ''}>重量纪录</option></select></div>${rows ? `<section class="history-list">${rows}</section>` : empty('还没有匹配的历史收获。抛下一竿吧。')}`;
  }
  function renderCatchDetail(catchId) {
    const entry = snapshot.state.history.find((item) => item.catchId === catchId);
    if (!entry) return `${header('收获详情')}${empty('记录不存在，可能已被历史上限裁剪。')}`;
    const fish = snapshot.catalog.find((item) => item.id === entry.resultId) || { id: entry.resultId, name: entry.name };
    const saleState = entry.soldAt == null ? '仍在仓库' : `已于 ${dateText(entry.soldAt)} 售出`;
    const variant = normalizeVariant(entry.variant);
    return `${header(entry.name, dateText(entry.at))}<article class="detail-card rarity-${entry.rarity}"><div class="detail-hero">${fishFrame(fish, true, variant)}<div><h2>${escapeHtml(entry.name)}</h2><p class="rarity-label">${escapeHtml(entry.rarityName)} · ${escapeHtml(entry.packName)} · ${VARIANT_NAMES[variant]}</p><p>${entry.first ? '首次发现' : '重复捕获'}${entry.recordLength || entry.recordWeight ? ' · 刷新个人纪录' : ''}</p></div></div><div class="facts">${fact('长度', entry.size)}${fact('重量', entry.weight)}${fact('捕获时间', dateText(entry.at))}${fact('鱼获价值', coinText(entry.valueCoins))}${fact('仓库状态', saleState)}${fact('个人纪录', entry.recordLength || entry.recordWeight ? '是' : '否')}</div></article>`;
  }
  function settingRow(label, note, control) { return `<label class="setting-row"><span><strong>${label}</strong><small>${note}</small></span>${control}</label>`; }
  function shortcutRow(kind, label) {
    const shortcuts = snapshot.app?.shortcuts || {};
    const value = shortcuts[kind] || '';
    const registered = Boolean(shortcuts[`${kind}Registered`]);
    return `<div class="setting-row shortcut-row"><span><strong>${label}</strong><small>${registered ? '当前已注册；修改后立即验证' : '当前注册失败，可输入新组合键'}</small></span><div class="shortcut-control"><img src="../assets/ui/icons/settings.svg" alt=""><input id="${kind}Shortcut" value="${escapeHtml(value)}" aria-label="${label}" spellcheck="false"><button class="pixel-button compact" data-shortcut="${kind}" type="button">应用</button></div></div>`;
  }
  function renderSettings() {
    const settings = snapshot.state.settings;
    const autoCastOwned = (snapshot.state.equipment?.ownedIds || []).includes(PondGame.AUTO_CAST_ROD_ID);
    const aquariumSettings = aquariumEnabled() ? aquariumData().settings : null;
    const aquariumSection = aquariumEnabled() ? `<h2 class="settings-section-title">桌面鱼缸</h2><section class="settings-list">
      ${settingRow('鱼缸大小', '75%～125%，视觉缩放不改变 8 条/12 负载容量', `<span class="range-control"><input id="aquariumScale" type="range" min="0.75" max="1.25" step="0.01" value="${Number(aquariumSettings.scale) || 1}"><output id="aquariumScaleValue">${Math.round((Number(aquariumSettings.scale) || 1) * 100)}%</output></span>`)}
      ${settingRow('鱼缸置顶', '关闭后允许工作窗口覆盖鱼缸', checkbox('aquariumAlwaysOnTop', aquariumSettings.alwaysOnTop !== false))}
      ${settingRow('锁定鱼缸', '锁定后窗口鼠标穿透，可从托盘或快捷键解除', checkbox('aquariumInputLocked', Boolean(aquariumSettings.inputLocked)))}
      ${settingRow('鱼缸水声', '仅在鱼缸可见且显式开启时播放', checkbox('aquariumWaterSound', Boolean(aquariumSettings.waterSound)))}
      ${settingRow('显示鱼缸', '隐藏期间停止动画，不补算离线帧', checkbox('aquariumVisible', Boolean(aquariumData().visible)))}
      ${settingRow('鱼缸快捷键', '默认 Ctrl+Shift+A；冲突时保留原设置', `<span class="shortcut-control"><input id="aquariumShortcut" value="${escapeHtml(aquariumSettings.shortcut || 'CommandOrControl+Shift+A')}" aria-label="鱼缸快捷键"><button class="pixel-button compact" data-action="aquarium-shortcut" type="button">应用</button></span>`)}
    </section>` : '';
    return `${header('设置', '修改后立即保存到本机')}<section class="settings-list">
      ${settingRow('桌宠大小', '75%～135%，可连续拖动并保持像素比例', `<span class="range-control"><input id="petScale" type="range" min="0.75" max="1.35" step="0.01" value="${settings.petScale}"><output id="petScaleValue">${Math.round(settings.petScale * 100)}%</output></span>`)}
      ${settingRow('保持置顶', '让桌宠停留在其他窗口上方', checkbox('alwaysOnTop', settings.alwaysOnTop))}
      ${settingRow('开机启动', '登录 Windows 后自动启动', checkbox('launchAtLogin', settings.launchAtLogin))}
      ${settingRow('静音', '默认开启，不打扰工作', checkbox('muted', settings.muted))}
      ${settingRow('轻微水泡声', '仅在未静音时播放克制提示', checkbox('sounds', settings.sounds))}
      ${settingRow('显示抛竿计时', '在船只下方显示本次等待秒表', checkbox('showCastTimer', settings.showCastTimer !== false))}
      ${settingRow('自动再次抛竿', autoCastOwned ? '中鱼并收杆后，在本轮动画结束时自动抛下一杆' : '在商店购买自动抛竿鱼竿后可用', checkbox('autoCastEnabled', autoCastOwned && settings.autoCastEnabled, !autoCastOwned))}
      ${shortcutRow('pet', '显示 / 隐藏快捷键')}
      ${shortcutRow('panel', '打开面板快捷键')}
      ${shortcutRow('fishing', '抛竿 / 收杆快捷键')}
    </section>${aquariumSection}<div class="button-row"><button class="pixel-button" data-action="export" type="button">导出存档</button><button class="pixel-button" data-action="import" type="button">导入存档</button><button class="pixel-button" data-action="reset-settings" type="button">恢复默认设置</button><button class="pixel-button" data-action="quit" type="button">退出游戏</button></div>`;
  }
  function checkbox(id, checked, disabled = false) { return `<input id="${id}" class="switch" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`; }
  function renderHelp() {
    const shortcuts = snapshot.app?.shortcuts || {};
    return `${header('玩法帮助')}<article class="detail-card"><h2>随时玩，随时停</h2><p>右键单击人物或船体，打开抛竿、收杆、垂钓场景和面板四个快捷按钮。10 秒没有操作会自动隐藏。未购买咸水鱼包时，咸水场景不可选。</p><p>鱼上钩后，直接左键单击桌宠或使用抛竿/收杆快捷键即可收杆。前 30 秒播放上钩提醒，之后恢复平缓持竿动画，静止的黄色叹号表示可以收杆。鱼获和特殊事件会保留，不会因为没及时点击而逃脱。</p><p>新存档首杆从抛竿到中鱼共 10 秒；第 2–5 杆等待 30–90 秒；第 6 杆起等待 5–10 分钟。重开游戏不会重置新手阶段。</p><p>商店钓饵会提高稀有鱼和异色鱼概率，并在每次抛竿时锁定本杆效果。自动抛竿鱼竿可在成功收杆后开始下一杆，也可随时在设置中关闭。</p><p>按住左键移动超过 6 像素即可拖动桌宠；拖动不会触发收杆，也不会拉长水面波纹。</p><div class="facts">${fact('显示/隐藏', shortcuts.pet || '未注册')}${fact('打开面板', shortcuts.panel || '未注册')}${fact('抛竿/收杆', shortcuts.fishing || '未注册')}${fact('关闭/返回', 'Esc')}${fact('隐私', '纯本地，不读取屏幕与其他应用')}</div></article>`;
  }
  function empty(message) { return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`; }
  function renderCharacters() {
    const library = snapshot.characters;
    const controls = `<div class="character-tools"><button type="button" class="pixel-button" data-character="import" ${characterBusy ? 'disabled' : ''}>导入角色</button><button type="button" class="pixel-button" data-character="refresh" ${characterBusy ? 'disabled' : ''}>刷新</button><button type="button" class="pixel-button" data-character="folder" ${characterBusy ? 'disabled' : ''}>打开角色目录</button></div>`;
    const cards = (library?.entries || []).map(entry => {
      const selected = entry.id === library.selectedId, ready = entry.status === 'ready';
      const label = selected ? '正在使用' : ready ? '使用角色' : entry.status === 'draft' ? '制作中' : '不可用';
      return `<article class="character-card ${selected ? 'is-selected' : ''}" data-character-card="${escapeHtml(entry.id)}">${entry.previewStrip ? `<div class="character-preview" role="img" aria-label="${escapeHtml(entry.name)}" style="background-image:url(&quot;${escapeHtml(entry.preview)}&quot;);background-size:${entry.previewStrip * 100}% 100%;background-repeat:no-repeat"></div>` : entry.preview ? `<img class="character-preview" src="${escapeHtml(entry.preview)}" alt="${escapeHtml(entry.name)}">` : '<div class="character-preview character-placeholder">待完成</div>'}<div class="character-copy"><h2>${escapeHtml(entry.name)}</h2><p>${escapeHtml(entry.error || entry.description || '人物、船与钓组的完整外观套装')}</p>${entry.design ? `<dl>${[['character','人物'],['boat','船'],['rod','鱼竿']].map(([key,label]) => `<div><dt>${label}</dt><dd>${escapeHtml(entry.design[key])}</dd></div>`).join('')}</dl>` : ''}</div><button type="button" class="pixel-button character-select" data-character="select" data-character-id="${escapeHtml(entry.id)}" ${selected || !ready || characterBusy ? 'disabled' : ''}>${label}</button></article>`;
    }).join('');
    return `${header('角色库', '换一位搭子，继续安静钓鱼')}${controls}${library?.notice ? `<p class="character-notice" role="status">${escapeHtml(library.notice)}</p>` : ''}<section class="character-list">${cards || empty('角色库尚未读取，请点击刷新重试。')}</section><p class="character-hint">想定制自己的搭子？在 Codex 中调用 screen-fishing-character-designer，依次设计人物、船和鱼竿。完成后回到这里刷新即可选择。</p>`;
  }
  function render() {
    if (!snapshot) { $('app').innerHTML = empty('正在读取本地存档……'); return; }
    $('saveState').textContent = snapshot.app?.persistenceError ? '存档未保存' : (snapshot.app?.persistenceNotice ? '备份已恢复' : '本地存档');
    $('saveState').title = snapshot.app?.persistenceError || snapshot.app?.persistenceNotice || '';
    $('saveState').style.color = snapshot.app?.persistenceError ? '#d56f5d' : (snapshot.app?.persistenceNotice ? '#d7b966' : '');
    const route = currentRoute();
    const html = route.page === 'home' ? renderHome()
      : route.page === 'encyclopedia' ? renderCatalog()
      : route.page === 'fish-detail' ? renderFishDetail(route.fishId)
      : route.page === 'warehouse' ? renderWarehouse()
      : route.page === 'inventory-detail' ? renderInventoryDetail(route.inventoryId)
      : route.page === 'aquarium' && aquariumEnabled() ? renderAquarium()
      : route.page === 'aquarium-layout' && aquariumEnabled() ? renderAquariumLayout(route.tankId || aquariumData().activeTankId)
      : route.page === 'shop' ? renderShop()
      : route.page === 'special-events' ? renderSpecialEvents()
      : route.page === 'special-event-detail' ? renderSpecialEventDetail(route.seriesId)
      : route.page === 'achievements' ? renderAchievements()
      : route.page === 'characters' ? renderCharacters()
      : route.page === 'history' ? renderHistory()
      : route.page === 'catch-detail' ? renderCatchDetail(route.catchId)
      : route.page === 'settings' ? renderSettings()
      : route.page === 'help' ? renderHelp() : renderHome();
    $('app').innerHTML = html;
    document.documentElement.style.setProperty('--page-header-height', `${document.querySelector('.page-header')?.offsetHeight || 60}px`);
    if (variantObserver) variantObserver.disconnect();
    variantObserver = null;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      variantObserver = new IntersectionObserver((entries) => entries.forEach((entry) => entry.target.classList.toggle('is-visible', entry.isIntersecting && pageVisible)), { threshold: 0.1 });
      document.querySelectorAll('.variant-iridescent').forEach((node) => {
        const rect = node.getBoundingClientRect();
        node.classList.toggle('is-visible', pageVisible && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth);
        variantObserver.observe(node);
      });
    }
    bindInputs(route.page);
    if (route.page === 'achievements') PondAchievementPanel.bind();
    if (route.page === 'aquarium-layout') hydrateLayoutAlphaCrops();
    const restoreScrollTop = Number(route.scrollTop) || 0;
    const restoreToken = (Number(route.restoreToken) || 0) + 1;
    route.restoreToken = restoreToken;
    route.restorePending = true;
    // Wait for the rebuilt grid and its image boxes to participate in layout.
    // Apply once synchronously and once after layout. Snapshot broadcasts that
    // arrive in between must not replace the saved offset with the temporary 0.
    const restoreScroll = () => {
      if (currentRoute() === route && route.restoreToken === restoreToken) $('app').scrollTop = restoreScrollTop;
    };
    restoreScroll();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      restoreScroll();
      if (currentRoute() === route && route.restoreToken === restoreToken) route.restorePending = false;
    }));
  }
  function bindInputs(page) {
    const listScope = page === 'encyclopedia' ? 'catalog' : page === 'warehouse' ? 'warehouse' : page === 'aquarium' ? 'aquarium' : '';
    if (listScope) {
      const query = document.querySelector(`[data-list-search="${listScope}"]`);
      const updateQuery = (event) => {
        if (event.isComposing) return;
        const value = event.target.value.trim(); const caret = event.target.selectionStart;
        listUi[listScope].query = value; currentRoute().scrollTop = 0; render();
        const restoreFocus = () => { const next = document.querySelector(`[data-list-search="${listScope}"]`); if (!next) return; next.focus({ preventScroll: true }); if (Number.isInteger(caret)) next.setSelectionRange(Math.min(caret, next.value.length), Math.min(caret, next.value.length)); };
        restoreFocus(); requestAnimationFrame(restoreFocus);
      };
      if (query) { query.oninput = updateQuery; query.oncompositionend = updateQuery; }
      document.querySelectorAll(`[data-list-scope="${listScope}"][data-list-field]`).forEach((input) => {
        input.onchange = (event) => {
          const selected = listUi[listScope][event.target.dataset.listField];
          if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
          currentRoute().scrollTop = 0; render();
        };
      });
    }
    if (page === 'history') {
      $('historyPack').onchange = (event) => { filters.history.pack = event.target.value; render(); };
      $('historyRarity').onchange = (event) => { filters.history.rarity = event.target.value; render(); };
      $('historyQuery').oninput = (event) => { filters.history.query = event.target.value.trim(); render(); $('historyQuery')?.focus(); };
      $('historySort').onchange = (event) => { filters.history.sort = event.target.value; render(); };
    }
    if (page === 'warehouse' && aquariumEnabled()) {
      $('inventoryDisplayFilter').onchange = (event) => { inventoryDisplayFilter = event.target.value; selectedInventoryIds.clear(); currentRoute().scrollTop = 0; render(); };
    }
    if (page === 'shop' && shopTab === 'aquarium') {
      $('aquariumShopHabitat').onchange = (event) => { aquariumShopHabitat = event.target.value; render(); };
      $('aquariumShopCategory').onchange = (event) => { aquariumShopCategory = event.target.value; render(); };
      $('aquariumShopOwned').onchange = (event) => { aquariumShopOwned = event.target.value; render(); };
    }
    if (page === 'aquarium-layout') {
      document.querySelectorAll('[data-layout-slot]').forEach((node) => { node.onchange = (event) => { pushLayoutHistory(); layoutDraft[event.target.dataset.layoutSlot] = event.target.value || null; render(); }; });
      if ($('decorScale')) {
        let scaleStart = null;
        $('decorScale').onpointerdown = () => { scaleStart = cloneLayout(layoutDraft); };
        $('decorScale').oninput = (event) => { const selected = layoutDraft.decor.find((item) => item.instanceId === selectedDecorInstanceId); if (!selected) return; selected.scale = Number(event.target.value); $('decorScaleValue').textContent = `${Math.round(selected.scale * 100)}%`; const node = document.querySelector(`[data-decor-instance="${CSS.escape(selectedDecorInstanceId)}"]`); if (node) node.style.setProperty('--decor-scale', selected.scale); };
        $('decorScale').onchange = () => { if (scaleStart) { layoutUndo.push(scaleStart); if (layoutUndo.length > 30) layoutUndo.shift(); layoutRedo = []; scaleStart = null; } render(); };
      }
      bindLayoutDrag();
    }
    if (page === 'settings') {
      for (const key of ['alwaysOnTop', 'launchAtLogin', 'muted', 'sounds', 'showCastTimer', 'autoCastEnabled']) {
        $(key).onchange = (event) => updateSettings({ [key]: event.target.checked });
      }
      $('petScale').oninput = (event) => {
        const value = Number(event.target.value);
        $('petScaleValue').textContent = `${Math.round(value * 100)}%`;
        previewPetScale(value);
      };
      $('petScale').onchange = async (event) => {
        const value = Number(event.target.value);
        pendingScale = null;
        if (scalePreviewPromise) await scalePreviewPromise;
        await updateSettings({ petScale: value }, false);
      };
      if (aquariumEnabled()) {
        $('aquariumScale').oninput = (event) => { $('aquariumScaleValue').textContent = `${Math.round(Number(event.target.value) * 100)}%`; };
        $('aquariumScale').onchange = async (event) => { const result = await runAquariumAction('set-setting', { scale: Number(event.target.value) }); if (result.ok) { toast('鱼缸大小已保存'); render(); } };
        $('aquariumAlwaysOnTop').onchange = async (event) => { const result = await runAquariumAction('set-setting', { alwaysOnTop: event.target.checked }); if (result.ok) render(); };
        $('aquariumInputLocked').onchange = async (event) => { const result = await runAquariumAction('set-setting', { inputLocked: event.target.checked }); if (result.ok) render(); };
        $('aquariumWaterSound').onchange = async (event) => { const result = await runAquariumAction('set-setting', { waterSound: event.target.checked }); if (result.ok) render(); };
        $('aquariumVisible').onchange = async (event) => {
          const method = event.target.checked ? window.desktopPond.showAquarium : window.desktopPond.hideAquarium;
          try { await method(); toast(event.target.checked ? '鱼缸已显示' : '鱼缸已隐藏'); }
          catch { toast('鱼缸窗口状态修改失败', true); render(); }
        };
      }
    }
  }
  function bindLayoutDrag() {
    const preview = $('layoutWaterPreview');
    if (!preview) return;
    preview.querySelectorAll('[data-decor-instance]').forEach((node) => {
      node.onkeydown = (event) => {
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        const placement = layoutDraft.decor.find((item) => item.instanceId === node.dataset.decorInstance);
        if (!placement) return;
        pushLayoutHistory(); selectedDecorInstanceId = placement.instanceId;
        if (event.key === 'ArrowLeft') placement.x -= 4 / 448;
        if (event.key === 'ArrowRight') placement.x += 4 / 448;
        if (event.key === 'ArrowUp') placement.y -= 4 / 192;
        if (event.key === 'ArrowDown') placement.y += 4 / 192;
        placement.x = Math.max(0, Math.min(1, placement.x)); placement.y = Math.max(0, Math.min(1, placement.y));
        render(); requestAnimationFrame(() => document.querySelector(`[data-decor-instance="${CSS.escape(placement.instanceId)}"]`)?.focus());
      };
      node.onpointerdown = (event) => {
        event.preventDefault();
        selectedDecorInstanceId = node.dataset.decorInstance;
        const placement = layoutDraft.decor.find((item) => item.instanceId === selectedDecorInstanceId);
        if (!placement) return;
        pushLayoutHistory();
        node.setPointerCapture(event.pointerId);
        const move = (moveEvent) => {
          const rect = preview.getBoundingClientRect();
          const xDip = Math.round(((moveEvent.clientX - rect.left) / rect.width * AQUARIUM_WATER.width) / 4) * 4;
          const yDip = Math.round(((moveEvent.clientY - rect.top) / rect.height * AQUARIUM_WATER.height) / 4) * 4;
          placement.x = Math.max(0, Math.min(1, xDip / AQUARIUM_WATER.width)); placement.y = Math.max(0, Math.min(1, yDip / AQUARIUM_WATER.height));
          node.style.left = `${placement.x * 100}%`; node.style.top = `${placement.y * 100}%`;
        };
        const end = () => { node.onpointermove = null; node.onpointerup = null; node.onpointercancel = null; render(); };
        node.onpointermove = move; node.onpointerup = end; node.onpointercancel = end;
      };
    });
  }
  async function updateSettings(patch, notify = true) {
    try {
      snapshot = await window.desktopPond.updateSettings(patch);
      if (snapshot.app?.persistenceError) toast('设置已应用，但存档写入失败', true);
      else if (notify) toast('设置已保存');
    } catch { toast('设置保存失败', true); }
  }
  function previewPetScale(value) {
    pendingScale = value;
    if (scalePreviewPromise) return;
    scalePreviewPromise = (async () => {
      while (pendingScale != null) {
        const next = pendingScale;
        pendingScale = null;
        snapshot = await window.desktopPond.previewPetScale(next);
      }
    })().catch(() => toast('桌宠大小预览失败', true)).finally(() => {
      scalePreviewPromise = null;
      if (pendingScale != null) previewPetScale(pendingScale);
    });
  }
  async function updateShortcut(kind) {
    const input = $(`${kind}Shortcut`);
    try {
      const result = await window.desktopPond.updateShortcut(kind, input.value);
      snapshot = result.snapshot || snapshot;
      if (!result.ok) { input.value = snapshot.app.shortcuts[kind] || ''; toast(result.error || '快捷键注册失败', true); }
      else toast('快捷键已更新');
      render();
    } catch { toast('快捷键更新失败，原设置保持不变', true); render(); }
  }
  function saleEntries(ids) {
    const wanted = new Set(ids);
    return (snapshot.state.inventory || []).filter((entry) => wanted.has(entry.inventoryId) && !entry.locked && !aquariumMembership(entry.inventoryId));
  }
  function showSaleConfirmation(ids) {
    const entries = saleEntries(ids);
    const excluded = ids.length - entries.length;
    if (!entries.length) return toast(excluded ? '展示中或已锁定的鱼不能出售' : '没有可出售的鱼', true);
    pendingSaleIds = entries.map((entry) => entry.inventoryId);
    const total = entries.reduce((sum, entry) => sum + (Number(entry.valueCoins) || 0), 0);
    const rows = entries.map((entry) => `<li><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.size)} · ${escapeHtml(entry.weight)}</small></span><b>${escapeHtml(coinText(entry.valueCoins))}</b></li>`).join('');
    $('modalContent').innerHTML = `<h2>${entries.length > 1 ? '确认批量出售' : '确认出售'}</h2><p class="muted">出售后鱼会从仓库移除，图鉴和历史记录仍会保留。${excluded ? `已自动排除 ${excluded} 条展示中或受保护鱼获。` : ''}</p><ul class="sale-confirm-list">${rows}</ul><div class="confirm-total"><span>${entries.length} 条鱼</span><strong>合计 ${escapeHtml(coinText(total))}</strong></div><button class="pixel-button danger" data-modal-action="confirm-sale" type="button">确认出售</button>`;
    $('detailModal').showModal();
  }
  function showPackConfirmation(packId) {
    const definition = packDefinition(packId);
    pendingPackId = packId;
    $('modalContent').innerHTML = `<h2>确认购买</h2><div class="pack-confirm"><img src="../assets/ui/icons/${definition.habitat}.svg" alt=""><div><strong>${escapeHtml(definition.name)}</strong><small>${definition.habitat === 'saltwater' ? '咸水' : '淡水'}鱼包 · 38 种鱼</small></div></div><p>花费 <strong class="coin-text">${escapeHtml(coinText(definition.priceCoins))}</strong>永久解锁；完成本级后才能继续购买下一鱼包，并会自动加入对应垂钓池。</p><button class="pixel-button" data-modal-action="confirm-pack" type="button">确认购买</button>`;
    $('detailModal').showModal();
  }
  function showEquipmentConfirmation(equipmentId) {
    const definition = PondGame.EQUIPMENT_DEFINITIONS[equipmentId];
    if (!definition) return toast('装备资料不存在', true);
    pendingEquipmentId = equipmentId;
    $('modalContent').innerHTML = `<h2>确认购买</h2><div class="pack-confirm"><img src="../assets/ui/icons/${escapeHtml(definition.icon)}" alt=""><div><strong>${escapeHtml(definition.name)}</strong><small>${definition.type === 'bait' ? '永久钓饵 · 购买后自动使用' : '永久鱼竿 · 购买后默认开启'}</small></div></div><p>花费 <strong class="coin-text">${escapeHtml(coinText(definition.priceCoins))}</strong>永久解锁。${escapeHtml(definition.description)}</p><button class="pixel-button" data-modal-action="confirm-equipment" type="button">确认购买</button>`;
    $('detailModal').showModal();
  }
  function economyError(reason, result = {}) {
    if (reason === 'previous-pack-required' || reason === 'prerequisite') {
      return `需先解锁 ${snapshot.packs[result.requiredPack] || result.requiredPack || '前置鱼包'}`;
    }
    if (reason === 'equipment-prerequisite') return `需先购买${PondGame.EQUIPMENT_DEFINITIONS[result.requiredEquipment]?.name || '前置装备'}`;
    return ({
      'empty-selection': '请先选择要出售的鱼',
      'inventory-not-found': '鱼已不在仓库中，请刷新后重试',
      'inventory-not-valued': '鱼获价值数据异常',
      'insufficient-funds': '金币不足',
      'already-owned': '已经拥有该商品',
      'not-purchasable': '该鱼包无需购买',
      'equipment-not-found': '装备资料不存在',
      'equipment-not-owned': '请先购买该钓饵',
      'not-bait': '该装备不能作为钓饵使用'
    })[reason] || '操作未完成，请稍后重试';
  }
  function aquariumError(reason, result = {}) {
    return ({
      'wrong-habitat': `这条鱼只能放入${HABITAT_NAMES[result.requiredHabitat] || '对应水域'}鱼缸`,
      'habitat-locked': '拥有任意咸水鱼包后才能使用咸水鱼缸',
      'count-full': '鱼缸已达到 8 条鱼上限',
      'bioload-full': `体型负载不足${Number.isFinite(result.requiredBioload) && Number.isFinite(result.availableBioload) ? `：需要 ${result.requiredBioload} 点，可用 ${result.availableBioload} 点` : ''}`,
      'inventory-missing': '鱼已不在仓库中，请刷新后重试',
      'already-displayed': '这条鱼已经在鱼缸中展示',
      'not-displayed': '这条鱼当前不在鱼缸中',
      'already-owned': '已经拥有该装饰，购买失败未扣款',
      'insufficient-coins': '金币不足，购买失败未扣款',
      'insufficient-funds': '金币不足，购买失败未扣款',
      'incompatible-habitat': '该装饰不适用于当前水域，购买失败未扣款',
      'invalid-layout': '布置无效，原有布局保持不变',
      'item-not-found': '装饰数据不存在',
      'tank-missing': '目标鱼缸不存在，原有数据保持不变',
      'invalid-habitat': '水域类型无效，原有数据保持不变',
      'aquarium-unavailable': '鱼缸系统尚未完成加载'
    })[reason] || result.error || '鱼缸操作未完成，原有数据保持不变';
  }
  async function runAquariumAction(action, payload = {}) {
    try {
      const api = window.desktopPond.aquariumAction;
      if (typeof api !== 'function') { toast(aquariumError('aquarium-unavailable'), true); return { ok: false, reason: 'aquarium-unavailable' }; }
      const result = await api(action, payload);
      if (result?.snapshot?.state) snapshot = result.snapshot;
      else if (result?.snapshot) snapshot = { ...snapshot, state: result.snapshot };
      else if (result?.state) snapshot = { ...snapshot, state: result.state };
      if (!result?.ok) { toast(aquariumError(result?.reason, result), true); render(); return result; }
      return result;
    } catch {
      toast('鱼缸数据保存失败，原有状态保持不变', true);
      return { ok: false, reason: 'ipc-error' };
    }
  }
  async function runEconomyAction(action, payload) {
    try {
      const result = await window.desktopPond.economyAction(action, payload);
      if (result?.snapshot) snapshot = result.snapshot;
      if (!result?.ok) { toast(result?.error || economyError(result?.reason, result), true); render(); return result; }
      return result;
    } catch {
      toast('本地经济数据保存失败', true);
      return { ok: false, reason: 'ipc-error' };
    }
  }
  $('app').addEventListener('click', async (event) => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.character) {
      if (characterBusy) return;
      characterBusy = true; render();
      try {
        const result = await window.desktopPond.characterAction(target.dataset.character, target.dataset.characterId);
        if (!result?.ok) toast(result?.error || '角色操作失败，请重试', true);
        else if (!result.canceled) { if (result.snapshot) snapshot = result.snapshot; toast(target.dataset.character === 'select' ? '已切换角色，钓鱼进度保持不变' : target.dataset.character === 'import' ? '角色已导入' : '角色库已更新'); }
      } catch { toast('角色操作失败，请重试', true); }
      finally { characterBusy = false; render(); }
      return;
    }
    if (target.dataset.action === 'back') return back();
    if (target.dataset.action === 'list-sort') {
      const ui = listUi[target.dataset.listScope]; const mode = target.dataset.sortMode;
      if (!ui || !SORT_MODES.some(([value]) => value === mode)) return;
      if (ui.mode === mode) ui.direction = ui.direction === 'asc' ? 'desc' : 'asc';
      else { ui.mode = mode; ui.direction = mode === 'catalog' ? 'asc' : 'desc'; }
      currentRoute().scrollTop = 0; return render();
    }
    if (target.dataset.action === 'list-sort-toggle') {
      const ui = listUi[target.dataset.listScope]; if (!ui) return;
      ui.sortsOpen = !ui.sortsOpen; return render();
    }
    if (target.dataset.action === 'list-sort-option') {
      const ui = listUi[target.dataset.listScope]; const mode = target.dataset.sortMode;
      if (!ui || !SORT_MODES.some(([value]) => value === mode)) return;
      if (ui.mode === mode) ui.direction = ui.direction === 'asc' ? 'desc' : 'asc';
      else { ui.mode = mode; ui.direction = mode === 'catalog' ? 'asc' : 'desc'; }
      ui.sortsOpen = false; currentRoute().scrollTop = 0; return render();
    }
    if (target.dataset.action === 'list-filter-toggle') {
      const ui = listUi[target.dataset.listScope]; if (!ui) return;
      ui.filtersOpen = !ui.filtersOpen; return render();
    }
    if (target.dataset.page) {
      if (target.dataset.page === 'aquarium-layout') {
        const tankId = target.dataset.tankId || aquariumData().activeTankId; const habitat = aquariumTank(tankId).habitat || aquariumHabitat;
        const result = await runAquariumAction('open-layout', { active: true, habitat, tankId });
        if (!result.ok) return;
      }
      return navigate({ page: target.dataset.page, ...(target.dataset.habitat ? { habitat: target.dataset.habitat } : {}), ...(target.dataset.tankId ? { tankId: target.dataset.tankId } : {}), ...(target.dataset.seriesId ? { seriesId: target.dataset.seriesId } : {}) });
    }
    if (target.dataset.fish) {
      if (target.dataset.locked === 'true') return toast('这条鱼尚未发现');
      return navigate({ page: 'fish-detail', fishId: target.dataset.fish });
    }
    if (target.dataset.achievement) return showAchievement(target.dataset.achievement);
    if (target.dataset.catch) return navigate({ page: 'catch-detail', catchId: target.dataset.catch });
    if (target.dataset.action === 'toggle-bulk') {
      inventoryBulkMode = !inventoryBulkMode;
      selectedInventoryIds.clear();
      return render();
    }
    if (target.dataset.action === 'confirm-bulk-sale') return showSaleConfirmation([...selectedInventoryIds]);
    if (target.dataset.action === 'sell-detail') return showSaleConfirmation([target.dataset.inventory]);
    if (target.dataset.action === 'aquarium-select-tank') {
      const result = await runAquariumAction('switch-tank', { tankId: target.dataset.tankId });
      if (result.ok) { toast(`已选择${aquariumTank(target.dataset.tankId).name}`); render(); }
      return;
    }
    if (target.dataset.action === 'aquarium-tank-habitat') {
      const tank = aquariumTank(target.dataset.tankId); const habitat = target.dataset.habitat;
      if (tank.habitat === habitat) return;
      const incompatible = aquariumUsage(tank.tankId).entries.filter((entry) => fishHabitat(entry) !== habitat).length;
      pendingTankHabitat = { tankId: tank.tankId, habitat };
      $('modalContent').innerHTML = `<h2>切换${escapeHtml(tank.name)}水域</h2><p>将鱼缸切换为<strong>${HABITAT_NAMES[habitat]}</strong>环境。${incompatible ? `当前 ${incompatible} 条不兼容鱼会自动安全移回仓库。` : '当前展示鱼均兼容。'}</p><p class="muted">鱼不会被出售或删除，布置会按新水域规则重新校验。</p><button class="pixel-button" data-modal-action="confirm-tank-habitat" type="button">确认切换</button>`;
      $('detailModal').showModal();
      return;
    }
    if (target.dataset.action === 'aquarium-place-fish') {
      const entry = (snapshot.state.inventory || []).find((item) => item.inventoryId === target.dataset.inventory);
      if (!entry) return toast('鱼已不在仓库中', true);
      const tank = aquariumTank(target.dataset.tankId || aquariumData().activeTankId); const habitat = tank.habitat || fishHabitat(entry);
      const result = await runAquariumAction('place-fish', { inventoryId: entry.inventoryId, habitat, tankId: tank.tankId });
      if (result.ok) { aquariumHabitat = habitat; toast(`已放入${tank.name}`); render(); }
      return;
    }
    if (target.dataset.action === 'aquarium-remove-fish') {
      const tank = aquariumMembershipInfo(target.dataset.inventory) || aquariumTank(target.dataset.tankId || aquariumData().activeTankId); const habitat = tank.habitat || aquariumHabitat;
      const result = await runAquariumAction('remove-fish', { inventoryId: target.dataset.inventory, habitat, tankId: tank.tankId });
      if (result.ok) { toast('已移出鱼缸，鱼仍保留在仓库'); render(); }
      return;
    }
    if (target.dataset.action === 'aquarium-toggle-window') {
      try { if (aquariumData().visible) await window.desktopPond.hideAquarium(); else await window.desktopPond.showAquarium(); toast(aquariumData().visible ? '正在隐藏桌面鱼缸' : '正在显示桌面鱼缸'); }
      catch { toast('桌面鱼缸窗口状态修改失败', true); }
      return;
    }
    if (target.dataset.action === 'aquarium-shortcut') {
      return updateShortcut('aquarium');
    }
    if (target.dataset.action === 'shop-tab') { shopTab = target.dataset.tab === 'aquarium' ? 'aquarium' : 'packs'; return render(); }
    if (target.dataset.action === 'aquarium-item-detail') {
      const item = aquariumItem(target.dataset.item); if (!item) return toast('装饰资料不存在', true);
      const isTank = itemCategory(item) === 'tank'; const owned = !isTank && aquariumData().ownedItemIds.includes(itemIdOf(item));
      const tankCount = isTank ? aquariumTanks().filter((tank) => tank.skinId === itemIdOf(item)).length : 0;
      const price = itemPrice(item); const habitat = item.habitat || 'both'; const canUseHabitat = habitat !== 'saltwater' || habitatUnlocked('saltwater');
      const canBuy = Number(snapshot.state.wallet?.balance) >= price && canUseHabitat && price > 0;
      const habitatText = (item.habitat || 'both') === 'both' ? '淡水/咸水' : HABITAT_NAMES[item.habitat] || item.habitat;
      const targetTank = aquariumTanks().find((tank) => habitat === 'both' || tank.habitat === habitat) || activeAquariumTank();
      pendingAquariumItemId = itemIdOf(item);
      const action = isTank
        ? `<p class="aquarium-note">当前已有 ${tankCount} 个该款式；每次购买都会新增独立鱼缸。</p><button class="pixel-button" data-modal-action="confirm-aquarium-item" type="button" ${canBuy ? '' : 'disabled'}>新增鱼缸 · ${escapeHtml(coinText(price))}</button>`
        : owned ? `<p class="aquarium-note">已永久拥有，可前往布置页使用。</p><button class="pixel-button" data-modal-action="go-aquarium-layout" data-tank-id="${escapeHtml(targetTank.tankId)}" type="button">去布置</button>`
          : `<p class="muted">购买失败不会扣除金币；装饰不影响钓鱼概率和收益。</p><button class="pixel-button" data-modal-action="confirm-aquarium-item" type="button" ${canBuy ? '' : 'disabled'}>购买 · ${escapeHtml(coinText(price))}</button>`;
      $('modalContent').innerHTML = `<h2>${escapeHtml(item.name)}</h2><div class="aquarium-item-scale-preview"><img src="${escapeHtml(itemAsset(item))}" alt="${escapeHtml(item.name)}"></div><div class="facts">${fact('类别', AQUARIUM_CATEGORY_NAMES[itemCategory(item)] || itemCategory(item))}${fact('适用水域', habitatText)}${fact('布置负载', String(Math.max(0, Number(item.load ?? item.capacityCost ?? item.cost ?? 0))))}${fact('价格', isTank ? coinText(price) : owned ? '已拥有' : coinText(price))}</div>${action}`;
      $('detailModal').showModal(); return;
    }
    if (target.dataset.action === 'aquarium-buy-item') {
      const item = aquariumItem(target.dataset.item); if (!item) return toast('装饰资料不存在', true);
      pendingAquariumItemId = itemIdOf(item);
      const isTank = itemCategory(item) === 'tank';
      $('modalContent').innerHTML = `<h2>确认购买</h2><div class="aquarium-purchase-confirm"><img src="${escapeHtml(itemAsset(item))}" alt=""><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(AQUARIUM_CATEGORY_NAMES[itemCategory(item)] || itemCategory(item))}</small></div></div><p>花费 <strong class="coin-text">${escapeHtml(coinText(itemPrice(item)))}</strong>${isTank ? '新增一个独立鱼缸，可单独选择水域、展示鱼和布置。' : '永久解锁。装饰不能转卖，也不会改变钓鱼收益。'}</p><button class="pixel-button" data-modal-action="confirm-aquarium-item" type="button">确认${isTank ? '新增鱼缸' : '购买'}</button>`;
      $('detailModal').showModal(); return;
    }
    if (target.dataset.action === 'layout-add') {
      const itemId = target.dataset.item; const status = layoutStatus(layoutDraft);
      if (status.count >= 8) return toast('自由装饰最多放置 8 个', true);
      const sameCount = layoutDraft.decor.filter((item) => item.itemId === itemId).length;
      if (sameCount >= 3) return toast('同一装饰最多放置 3 份', true);
      pushLayoutHistory();
      const instanceId = `draft-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
      layoutDraft.decor.push({ instanceId, itemId, x: .5, y: .72, layer: aquariumItem(itemId)?.layer || 'mid', scale: 1, flipX: false });
      selectedDecorInstanceId = instanceId; return render();
    }
    if (target.dataset.decorInstance) { selectedDecorInstanceId = target.dataset.decorInstance; return render(); }
    if (target.dataset.action === 'layout-undo' && layoutUndo.length) { layoutRedo.push(cloneLayout(layoutDraft)); layoutDraft = layoutUndo.pop(); selectedDecorInstanceId = null; return render(); }
    if (target.dataset.action === 'layout-redo' && layoutRedo.length) { layoutUndo.push(cloneLayout(layoutDraft)); layoutDraft = layoutRedo.pop(); selectedDecorInstanceId = null; return render(); }
    if (target.dataset.action === 'layout-default') { pushLayoutHistory(); const defaults = catalogDefaultLayout(aquariumHabitat); layoutDraft = { ...defaults, tankId: layoutDraft.tankId, skinId: layoutDraft.skinId }; selectedDecorInstanceId = null; return render(); }
    if (target.dataset.action === 'layout-scale-step') { const selected = layoutDraft.decor.find((item) => item.instanceId === selectedDecorInstanceId); if (!selected) return; pushLayoutHistory(); selected.scale = Math.max(.5, Math.min(2, Math.round(((Number(selected.scale) || 1) + Number(target.dataset.scaleDelta)) * 20) / 20)); return render(); }
    if (target.dataset.action === 'layout-flip') { const selected = layoutDraft.decor.find((item) => item.instanceId === selectedDecorInstanceId); if (selected) { pushLayoutHistory(); selected.flipX = !selected.flipX; render(); } return; }
    if (target.dataset.action === 'layout-remove') { pushLayoutHistory(); layoutDraft.decor = layoutDraft.decor.filter((item) => item.instanceId !== selectedDecorInstanceId); selectedDecorInstanceId = null; return render(); }
    if (target.dataset.action === 'layout-cancel') return back();
    if (target.dataset.action === 'layout-save') {
      const status = layoutStatus(layoutDraft); if (!status.valid) return toast(status.reason, true);
      const result = await runAquariumAction('save-layout', { habitat: aquariumHabitat, tankId: layoutDraft.tankId, layout: cloneLayout(layoutDraft) });
      if (result.ok) { layoutDraft = null; layoutUndo = []; layoutRedo = []; toast('鱼缸布置已原子保存'); back(); }
      return;
    }
    if (target.dataset.action === 'toggle-lock') {
      const locked = target.dataset.locked !== 'true';
      const result = await runEconomyAction('set-inventory-lock', { inventoryId: target.dataset.inventory, locked });
      if (result.ok) { toast(locked ? '鱼获已锁定' : '鱼获已解锁'); render(); }
      return;
    }
    if (target.dataset.buyPack) return showPackConfirmation(target.dataset.buyPack);
    if (target.dataset.buyEquipment) return showEquipmentConfirmation(target.dataset.buyEquipment);
    if (Object.hasOwn(target.dataset, 'equipBait')) {
      const result = await runEconomyAction('equip-bait', { baitId: target.dataset.equipBait || null });
      if (result.ok) { toast(target.dataset.equipBait ? `已使用${PondGame.EQUIPMENT_DEFINITIONS[target.dataset.equipBait]?.name || '钓饵'}，下一杆生效` : '已停用钓饵，下一杆生效'); render(); }
      return;
    }
    if (target.dataset.inventory) {
      if (inventoryBulkMode) {
        const entry = (snapshot.state.inventory || []).find((item) => item.inventoryId === target.dataset.inventory);
        if (entry?.locked) return toast('锁定鱼获不能加入批量出售', true);
        if (aquariumMembership(target.dataset.inventory)) return toast('展示中的鱼不能加入批量出售，请先移出鱼缸', true);
        currentRoute().scrollTop = $('app').scrollTop;
        if (selectedInventoryIds.has(target.dataset.inventory)) selectedInventoryIds.delete(target.dataset.inventory);
        else selectedInventoryIds.add(target.dataset.inventory);
        return render();
      }
      return navigate({ page: 'inventory-detail', inventoryId: target.dataset.inventory });
    }

    if (target.dataset.action === 'export') { const result = await window.desktopPond.exportSave(); return !result.canceled && toast(result.ok ? '存档已导出' : result.error || '导出失败', !result.ok); }
    if (target.dataset.action === 'import') { const result = await window.desktopPond.importSave(); return !result.canceled && toast(result.ok ? '存档已导入，并创建了备份' : result.error || '导入失败', !result.ok); }
    if (target.dataset.shortcut) return updateShortcut(target.dataset.shortcut);
    if (target.dataset.action === 'reset-settings') {
      const { petShortcut, panelShortcut, fishingShortcut, ...settings } = PondGame.defaultSettings;
      snapshot = await window.desktopPond.updateSettings(settings);
      const petResult = await window.desktopPond.updateShortcut('pet', petShortcut);
      const panelResult = await window.desktopPond.updateShortcut('panel', panelShortcut);
      const fishingResult = await window.desktopPond.updateShortcut('fishing', fishingShortcut);
      snapshot = fishingResult.snapshot || panelResult.snapshot || petResult.snapshot || snapshot;
      const shortcutsOk = petResult.ok && panelResult.ok && fishingResult.ok;
      toast(shortcutsOk ? '已恢复默认设置' : '常规设置已恢复，快捷键因冲突保持原值', !shortcutsOk); render();
    }
    if (target.dataset.action === 'quit') window.desktopPond.quit();
  });
  $('app').addEventListener('contextmenu', (event) => {
    const target = event.target.closest('.inventory-card[data-inventory]');
    if (!target) return;
    event.preventDefault();
    if (inventoryBulkMode) return toast('批量模式下请使用左键选择，锁定鱼获不可出售', true);
    if ((snapshot.state.inventory || []).find((entry) => entry.inventoryId === target.dataset.inventory)?.locked) return toast('该鱼获已锁定，请先解锁', true);
    if (aquariumMembership(target.dataset.inventory)) return toast('该鱼正在鱼缸展示，请先移出后再出售', true);
    showSaleConfirmation([target.dataset.inventory]);
  });
  $('modalContent').addEventListener('click', async (event) => {
    const target = event.target.closest('button[data-modal-action]');
    if (!target) return;
    target.disabled = true;
    if (target.dataset.modalAction === 'confirm-sale') {
      const soldIds = [...pendingSaleIds];
      const result = await runEconomyAction('sell-inventory', { inventoryIds: soldIds });
      if (!result.ok) { target.disabled = false; return; }
      for (const id of soldIds) selectedInventoryIds.delete(id);
      pendingSaleIds = [];
      $('detailModal').close();
      toast(`已出售 ${result.sold?.length || soldIds.length} 条鱼，获得 ${coinText(result.earned)}`);
      if (currentRoute().page === 'inventory-detail') routeStack.pop();
      render();
    }
    if (target.dataset.modalAction === 'confirm-pack') {
      const packId = pendingPackId;
      const result = await runEconomyAction('purchase-pack', { packId });
      if (!result.ok) { target.disabled = false; return; }
      pendingPackId = null;
      $('detailModal').close();
      toast(`已解锁${snapshot.packs[packId] || '鱼包'}`);
      render();
    }
    if (target.dataset.modalAction === 'confirm-equipment') {
      const equipmentId = pendingEquipmentId;
      const result = await runEconomyAction('purchase-equipment', { equipmentId });
      if (!result.ok) { target.disabled = false; return; }
      pendingEquipmentId = null;
      $('detailModal').close();
      toast(`已购买${PondGame.EQUIPMENT_DEFINITIONS[equipmentId]?.name || '装备'}`);
      render();
    }
    if (target.dataset.modalAction === 'confirm-tank-habitat') {
      const request = pendingTankHabitat;
      if (!request) { target.disabled = false; return; }
      const result = await runAquariumAction('set-tank-habitat', request);
      if (!result.ok) { target.disabled = false; return; }
      pendingTankHabitat = null;
      $('detailModal').close();
      const removedFish = Math.max(0, Number(result.removedFishCount) || 0);
      const removedDecor = Math.max(0, Number(result.removedDecorCount) || 0);
      toast(`水域已切换${removedFish ? `，${removedFish} 条鱼已移回仓库` : ''}${removedDecor ? `，${removedDecor} 件不兼容装饰已收起` : ''}`);
      render();
    }
    if (target.dataset.modalAction === 'confirm-aquarium-item') {
      const itemId = pendingAquariumItemId;
      const item = aquariumItem(itemId);
      const isTank = itemCategory(item) === 'tank'; const activeTank = activeAquariumTank();
      const result = await runAquariumAction('purchase-item', { itemId, habitat: item?.habitat === 'both' ? activeTank.habitat : item?.habitat });
      if (!result.ok) { target.disabled = false; return; }
      pendingAquariumItemId = null;
      $('detailModal').close();
      toast(isTank ? `已新增${aquariumTank(result.createdTankId).name || '鱼缸'}` : '装饰已永久解锁');
      render();
    }
    if (target.dataset.modalAction === 'go-aquarium-layout') {
      const tankId = target.dataset.tankId || aquariumData().activeTankId; const habitat = aquariumTank(tankId).habitat || aquariumData().activeHabitat;
      const result = await runAquariumAction('open-layout', { active: true, habitat, tankId });
      if (!result.ok) { target.disabled = false; return; }
      $('detailModal').close();
      navigate({ page: 'aquarium-layout', habitat, tankId });
    }
  });
  $('closePanel').onclick = async () => {
    if (currentRoute().page === 'aquarium-layout') await runAquariumAction('open-layout', { active: false, habitat: aquariumHabitat, tankId: currentRoute().tankId || aquariumData().activeTankId });
    layoutDraft = null; layoutUndo = []; layoutRedo = []; selectedDecorInstanceId = null;
    window.desktopPond.closePanel();
  };
  $('closeModal').onclick = () => { pendingSaleIds = []; pendingPackId = null; pendingEquipmentId = null; pendingAquariumItemId = null; pendingTankHabitat = null; $('detailModal').close(); };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if ($('detailModal').open) $('detailModal').close(); else back();
      return;
    }
    if (currentRoute().page !== 'encyclopedia' || !event.key.startsWith('Arrow')) return;
    const cards = [...document.querySelectorAll('.catalog-grid .icon-card')];
    const current = cards.indexOf(document.activeElement);
    if (current < 0) return;
    const grid = cards[current].closest('.catalog-grid');
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    // Each pack is its own grid; ArrowDown follows the visible column count.
    const packCards = [...grid.querySelectorAll('.icon-card')];
    const packIndex = packCards.indexOf(cards[current]);
    const next = current - packIndex + PondNavigation.nextGridIndex(packIndex, event.key, packCards.length, columns);
    if (next !== current) { event.preventDefault(); cards[next].focus(); cards[next].scrollIntoView({ block: 'nearest' }); }
  });
  // Resizing changes the grid, never the typography. Track the sticky header's
  // real height so a wrapped subtitle cannot overlap the warehouse toolbar.
  new ResizeObserver(() => {
    const header = document.querySelector('.page-header');
    document.documentElement.style.setProperty('--page-header-height', `${header?.offsetHeight || 60}px`);
  }).observe($('app'));
  document.addEventListener('visibilitychange', () => { pageVisible = !document.hidden; document.querySelectorAll('.variant-iridescent').forEach((node) => node.classList.toggle('is-visible', pageVisible && node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().top < innerHeight)); });
  window.desktopPond.onUpdate((value) => {
    PondAchievementPanel.notify(snapshot, value);
    if (!currentRoute().restorePending) currentRoute().scrollTop = $('app').scrollTop;
    snapshot = value;
    PondAchievementPanel.refreshDetail();
    if (currentRoute().page === 'achievements' && PondAchievementPanel.deferUpdate()) return;
    render();
  });
  window.desktopPond.onNavigate((route) => {
    if (currentRoute().page === 'aquarium-layout') runAquariumAction('open-layout', { active: false, habitat: aquariumHabitat, tankId: currentRoute().tankId || aquariumData().activeTankId });
    layoutDraft = null; layoutUndo = []; layoutRedo = []; selectedDecorInstanceId = null;
    const requested = route || { page:'home' };
    const target = !aquariumEnabled() && String(requested.page || '').startsWith('aquarium') ? { page:'home' } : requested;
    routeStack = target.page === 'home' ? [{ ...target, scrollTop: 0 }] : [{ page: 'home', scrollTop: 0 }, { ...target, scrollTop: 0 }];
    render();
  });
  window.desktopPond.getSnapshot().then((value) => {
    snapshot = value; render();
    window.desktopPond.panelReady?.({ ok:true });
  }).catch(() => {
    $('saveState').textContent = '加载失败'; render();
    window.desktopPond.panelReady?.({ ok:false });
  });
})();
