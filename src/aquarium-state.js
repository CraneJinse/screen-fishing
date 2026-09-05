(function exposeAquariumState(globalScope) {
  'use strict';

  const DEFAULT_CATALOG = typeof module !== 'undefined' && module.exports
    ? require('../data/aquarium-catalog.json')
    : (globalScope.PondAquariumCatalog || { items: [], starterItemIds: [] });
  const AQUARIUM_VERSION = 2;
  const HABITATS = Object.freeze(['freshwater', 'saltwater']);
  const LANES = Object.freeze(['back', 'middle', 'front']);
  const SIZE_CLASSES = Object.freeze({
    tiny: Object.freeze({ bioload: 1, displayPixels: Object.freeze([24, 30]) }),
    small: Object.freeze({ bioload: 2, displayPixels: Object.freeze([32, 38]) }),
    large: Object.freeze({ bioload: 3, displayPixels: Object.freeze([42, 48]) }),
    giant: Object.freeze({ bioload: 4, displayPixels: Object.freeze([50, 58]) })
  });
  const DEFAULT_LIMITS = Object.freeze({
    maxFishCount: 8,
    bioloadCapacity: 12,
    maxDecorInstances: 8,
    decorCapacity: 12,
    maxCopiesPerItem: 3,
    maxOpaqueCoverage: 0.38
  });
  const DEFAULT_VIEWPORT = Object.freeze({ width: 448, height: 192, gridDip: 4 });
  const DEFAULT_SETTINGS = Object.freeze({
    scale: 1,
    alwaysOnTop: true,
    inputLocked: false,
    waterSound: false,
    shortcut: 'CommandOrControl+Shift+A'
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function limitsFor(catalog = DEFAULT_CATALOG) {
    return { ...DEFAULT_LIMITS, ...(catalog?.limits || {}) };
  }

  function viewportFor(catalog = DEFAULT_CATALOG) {
    return { ...DEFAULT_VIEWPORT, ...(catalog?.waterViewport || {}) };
  }

  function catalogItems(catalog = DEFAULT_CATALOG) {
    return Array.isArray(catalog?.items) ? catalog.items : [];
  }

  function catalogMap(catalog = DEFAULT_CATALOG) {
    return new Map(catalogItems(catalog).map((item) => [item.id, item]));
  }

  function habitatMatches(itemHabitat, habitat) {
    return itemHabitat === 'both' || itemHabitat === habitat;
  }

  function habitatForInventory(entry) {
    if (HABITATS.includes(entry?.habitat)) return entry.habitat;
    const pack = String(entry?.pack || '');
    if (pack.startsWith('F')) return 'freshwater';
    if (pack.startsWith('S')) return 'saltwater';
    return null;
  }

  function saltwaterUnlocked(ownedPacks) {
    return (Array.isArray(ownedPacks) ? ownedPacks : []).some((pack) => pack === 'S1' || pack === 'S2');
  }

  function stableSeed(value) {
    let seed = 2166136261;
    for (const char of String(value || '')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    return seed || 1;
  }

  function sizeClassForFish(entry, override = {}) {
    const explicit = override.aquariumSizeClass || entry?.aquariumSizeClass;
    if (SIZE_CLASSES[explicit]) return explicit;
    const explicitLoad = Math.round(finite(override.aquariumBioload, finite(entry?.aquariumBioload, 0)));
    if (explicitLoad >= 1 && explicitLoad <= 4) return Object.keys(SIZE_CLASSES)[explicitLoad - 1];
    const name = String(override.name || entry?.name || '');
    const lengthCm = Math.max(0, finite(override.lengthCm, finite(entry?.lengthCm, 0)));
    if (/鳐|魟|蝠鲼/.test(name)) return lengthCm > 200 ? 'giant' : 'large';
    if (lengthCm > 200) return 'giant';
    if (lengthCm > 60) return 'large';
    if (lengthCm > 15) return 'small';
    return 'tiny';
  }

  function fishMetrics(entry, override = {}) {
    const sizeClass = sizeClassForFish(entry, override);
    return { sizeClass, ...SIZE_CLASSES[sizeClass] };
  }

  function defaultTank(habitat, catalog = DEFAULT_CATALOG) {
    const configured = catalog?.defaultLayouts?.[habitat];
    if (configured && typeof configured === 'object') return { ...clone(configured), fish: [] };
    return {
      skinId: 'tank-basic',
      backgroundId: null,
      substrateId: habitat === 'freshwater' ? 'substrate-river-sand' : null,
      effectId: null,
      fish: [],
      decor: habitat === 'freshwater' ? [
        { instanceId: 'starter-rock-round', itemId: 'rock-round', x: 0.25, y: 0.875, layer: 'mid', scale: 1, flipX: false },
        { instanceId: 'starter-plant-grass', itemId: 'plant-grass', x: 0.75, y: 0.75, layer: 'front', scale: 1, flipX: false }
      ] : []
    };
  }

  function createInitialAquariumState(catalog = DEFAULT_CATALOG) {
    const map = catalogMap(catalog);
    const starters = (Array.isArray(catalog?.starterItemIds) ? catalog.starterItemIds : [])
      .filter((id, index, list) => map.has(id) && list.indexOf(id) === index);
    const freshwater = defaultTank('freshwater', catalog);
    const saltwater = defaultTank('saltwater', catalog);
    return {
      version: AQUARIUM_VERSION,
      activeHabitat: 'freshwater',
      activeTankId: 'tank-1',
      visible: false,
      settings: { ...DEFAULT_SETTINGS },
      ownedItemIds: starters,
      tankInstances: [
        { tankId: 'tank-1', name: '鱼缸1', habitat: 'freshwater', ...clone(freshwater) }
      ],
      tanks: {
        freshwater,
        saltwater
      }
    };
  }

  function snapCoordinate(value, axis, catalog = DEFAULT_CATALOG) {
    const viewport = viewportFor(catalog);
    const extent = axis === 'x' ? viewport.width : viewport.height;
    const grid = Math.max(1, finite(viewport.gridDip, 4));
    const dip = Math.round(Math.min(1, Math.max(0, finite(value))) * extent / grid) * grid;
    return Number(Math.min(1, Math.max(0, dip / extent)).toFixed(8));
  }

  function canonicalDecor(raw, item, catalog = DEFAULT_CATALOG) {
    const requestedScale = Number(raw?.scale);
    const scale = Number.isFinite(requestedScale)
      ? Math.min(2, Math.max(0.5, Math.round(requestedScale * 20) / 20)) : 1;
    return {
      instanceId: String(raw?.instanceId || ''),
      itemId: item.id,
      x: snapCoordinate(raw?.x, 'x', catalog),
      y: snapCoordinate(raw?.y, 'y', catalog),
      layer: item.layer,
      scale,
      flipX: item.mirrorable ? Boolean(raw?.flipX) : false
    };
  }

  function placementInsideWater(decor, item, catalog = DEFAULT_CATALOG) {
    const viewport = viewportFor(catalog);
    const width = Math.max(0, finite(item?.footprint?.width)) * decor.scale;
    const height = Math.max(0, finite(item?.footprint?.height)) * decor.scale;
    const centerX = decor.x * viewport.width;
    const anchorY = decor.y * viewport.height;
    return centerX - width / 2 >= -1e-6
      && centerX + width / 2 <= viewport.width + 1e-6
      && anchorY - height >= -1e-6
      && anchorY <= viewport.height + 1e-6;
  }

  function decorCoverage(decor, item, catalog = DEFAULT_CATALOG) {
    if (!item?.opaque) return 0;
    const viewport = viewportFor(catalog);
    return (Math.max(0, finite(item.footprint?.width)) * decor.scale
      * Math.max(0, finite(item.footprint?.height)) * decor.scale)
      / Math.max(1, viewport.width * viewport.height);
  }

  function validateFixedSlot(id, slot, habitat, owned, map) {
    if (id == null && slot !== 'skin') return null;
    const item = map.get(id);
    if (!item || item.slot !== slot || !owned.has(item.id) || !habitatMatches(item.habitat, habitat)) return 'invalid-slot';
    return null;
  }

  function validateLayout(layout, habitat, ownedItemIds, catalog = DEFAULT_CATALOG) {
    const map = catalogMap(catalog);
    const owned = new Set(ownedItemIds || []);
    const limits = limitsFor(catalog);
    const errors = [];
    if (!HABITATS.includes(habitat) || !layout || typeof layout !== 'object') return { valid: false, reason: 'invalid-layout', errors: ['invalid-layout'] };
    for (const [key, slot] of [['skinId', 'skin'], ['backgroundId', 'background'], ['substrateId', 'substrate'], ['effectId', 'effect']]) {
      if (validateFixedSlot(layout[key], slot, habitat, owned, map)) errors.push(`${key}:invalid-slot`);
    }
    if (!Array.isArray(layout.decor)) errors.push('invalid-decor-list');
    const decor = Array.isArray(layout.decor) ? layout.decor : [];
    if (decor.length > limits.maxDecorInstances) errors.push('decor-count-full');
    const instanceIds = new Set();
    const copies = new Map();
    let load = 0;
    let coverage = 0;
    const canonical = [];
    for (const raw of decor) {
      const item = map.get(raw?.itemId);
      if (!raw?.instanceId || instanceIds.has(String(raw.instanceId))) { errors.push('duplicate-instance'); continue; }
      instanceIds.add(String(raw.instanceId));
      if (!item || item.slot !== 'decor' || !owned.has(item.id) || !habitatMatches(item.habitat, habitat)) { errors.push('invalid-decor'); continue; }
      const scale = Number(raw.scale ?? 1);
      if (!Number.isFinite(scale) || scale < 0.5 || scale > 2 || Math.abs(scale * 20 - Math.round(scale * 20)) > 1e-8) { errors.push('invalid-scale'); continue; }
      if (!Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y)) || Number(raw.x) < 0 || Number(raw.x) > 1 || Number(raw.y) < 0 || Number(raw.y) > 1) { errors.push('outside-water'); continue; }
      const entry = canonicalDecor(raw, item, catalog);
      if (!placementInsideWater(entry, item, catalog)) { errors.push('outside-water'); continue; }
      copies.set(item.id, (copies.get(item.id) || 0) + 1);
      if (copies.get(item.id) > limits.maxCopiesPerItem) errors.push('copy-limit');
      load += Math.max(0, finite(item.load));
      coverage += decorCoverage(entry, item, catalog);
      canonical.push(entry);
    }
    if (load > limits.decorCapacity) errors.push('decor-load-full');
    if (coverage > limits.maxOpaqueCoverage + 1e-9) errors.push('coverage-full');
    return {
      valid: errors.length === 0,
      reason: errors.length ? 'invalid-layout' : null,
      errors,
      layout: {
        skinId: layout.skinId,
        backgroundId: layout.backgroundId ?? null,
        substrateId: layout.substrateId ?? null,
        effectId: layout.effectId ?? null,
        decor: canonical
      },
      metrics: { decorCount: decor.length, decorLoad: load, opaqueCoverage: coverage }
    };
  }

  function normalizeTank(raw, habitat, inventoryById, ownedItemIds, usedInventoryIds, catalog = DEFAULT_CATALOG) {
    const fallback = defaultTank(habitat, catalog);
    const candidate = raw && typeof raw === 'object' ? raw : fallback;
    const baseLayout = {
      skinId: candidate.skinId,
      backgroundId: candidate.backgroundId,
      substrateId: candidate.substrateId,
      effectId: candidate.effectId,
      decor: candidate.decor
    };
    let checked = validateLayout(baseLayout, habitat, ownedItemIds, catalog);
    if (!checked.valid) {
      const clean = [];
      for (const entry of Array.isArray(candidate.decor) ? candidate.decor : []) {
        const attempt = validateLayout({ ...fallback, decor: [...clean, entry] }, habitat, ownedItemIds, catalog);
        if (attempt.valid) clean.push(attempt.layout.decor.at(-1));
      }
      checked = validateLayout({
        skinId: validateFixedSlot(candidate.skinId, 'skin', habitat, new Set(ownedItemIds), catalogMap(catalog)) ? fallback.skinId : candidate.skinId,
        backgroundId: validateFixedSlot(candidate.backgroundId, 'background', habitat, new Set(ownedItemIds), catalogMap(catalog)) ? null : candidate.backgroundId,
        substrateId: validateFixedSlot(candidate.substrateId, 'substrate', habitat, new Set(ownedItemIds), catalogMap(catalog)) ? fallback.substrateId : candidate.substrateId,
        effectId: validateFixedSlot(candidate.effectId, 'effect', habitat, new Set(ownedItemIds), catalogMap(catalog)) ? null : candidate.effectId,
        decor: clean
      }, habitat, ownedItemIds, catalog);
    }
    const limits = limitsFor(catalog);
    const fish = [];
    let bioload = 0;
    for (const rawFish of Array.isArray(candidate.fish) ? candidate.fish : []) {
      const inventoryId = String(rawFish?.inventoryId || '');
      const inventory = inventoryById.get(inventoryId);
      if (!inventory || usedInventoryIds.has(inventoryId) || habitatForInventory(inventory) !== habitat) continue;
      const metrics = fishMetrics(inventory);
      if (fish.length >= limits.maxFishCount || bioload + metrics.bioload > limits.bioloadCapacity) continue;
      usedInventoryIds.add(inventoryId);
      bioload += metrics.bioload;
      fish.push({
        inventoryId,
        lane: LANES.includes(rawFish?.lane) ? rawFish.lane : 'middle',
        motionSeed: Math.max(1, Math.floor(finite(rawFish?.motionSeed, stableSeed(inventoryId))))
      });
    }
    return { ...(checked.layout || fallback), fish };
  }

  function normalizeAquariumState(input, inventory = [], ownedPacks = ['F1'], catalog = DEFAULT_CATALOG) {
    const base = createInitialAquariumState(catalog);
    const value = input && typeof input === 'object' ? input : base;
    const map = catalogMap(catalog);
    const owned = [...new Set([
      ...base.ownedItemIds,
      ...(Array.isArray(value.ownedItemIds) ? value.ownedItemIds : [])
    ])].filter((id) => map.has(id));
    const inventoryById = new Map((Array.isArray(inventory) ? inventory : []).map((entry) => [String(entry.inventoryId), entry]));
    const used = new Set();
    const rawInstances = Array.isArray(value.tankInstances) ? value.tankInstances : [];
    const legacyTanks = rawInstances.length ? {
      freshwater: defaultTank('freshwater', catalog),
      saltwater: defaultTank('saltwater', catalog)
    } : {
      freshwater: normalizeTank(value.tanks?.freshwater, 'freshwater', inventoryById, owned, used, catalog),
      saltwater: normalizeTank(value.tanks?.saltwater, 'saltwater', inventoryById, owned, used, catalog)
    };
    const tankInstances = [];
    const tankIds = new Set();
    for (const raw of rawInstances) {
      const tankId = String(raw?.tankId || raw?.id || '');
      if (!tankId || tankIds.has(tankId) || !HABITATS.includes(raw?.habitat)) continue;
      tankIds.add(tankId);
      const tank = normalizeTank(raw, raw.habitat, inventoryById, owned, used, catalog);
      const boundSkin = map.get(raw.skinId);
      const skinId = boundSkin?.slot === 'skin' && habitatMatches(boundSkin.habitat, raw.habitat) ? boundSkin.id : tank.skinId;
      tankInstances.push({ tankId, name: String(raw.name || `鱼缸${tankInstances.length + 1}`), habitat: raw.habitat, ...tank, skinId });
    }
    // Schema 9 had exactly one profile per habitat. Preserve those profiles as
    // the first instances and keep the legacy aliases for old renderers.
    if (!tankInstances.some((tank) => tank.habitat === 'freshwater')) {
      tankInstances.push({ tankId: 'tank-1', name: '鱼缸1', habitat: 'freshwater', ...clone(legacyTanks.freshwater) });
      tankIds.add('tank-1');
    }
    const legacySalt = value.tanks?.saltwater;
    const hasLegacySalt = legacySalt && (legacySalt.fish?.length || legacySalt.decor?.length || legacySalt.skinId && legacySalt.skinId !== 'tank-basic' || legacySalt.substrateId || legacySalt.backgroundId || legacySalt.effectId);
    if (!tankInstances.some((tank) => tank.habitat === 'saltwater') && hasLegacySalt) {
      const tankId = tankIds.has('tank-2') ? `tank-${tankInstances.length + 1}` : 'tank-2';
      tankInstances.push({ tankId, name: `鱼缸${tankInstances.length + 1}`, habitat: 'saltwater', ...clone(legacyTanks.saltwater) });
      tankIds.add(tankId);
    }
    const requestedActiveTank = tankInstances.find((tank) => tank.tankId === value.activeTankId)
      || tankInstances.find((tank) => tank.habitat === (value.activeHabitat === 'saltwater' ? 'saltwater' : 'freshwater'))
      || tankInstances[0];
    const activeTank = requestedActiveTank?.habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)
      ? (tankInstances.find((tank) => tank.habitat === 'freshwater') || tankInstances[0])
      : requestedActiveTank;
    const tanks = {
      freshwater: tankInstances.find((tank) => tank.habitat === 'freshwater') || legacyTanks.freshwater,
      saltwater: tankInstances.find((tank) => tank.habitat === 'saltwater') || legacyTanks.saltwater
    };
    const settings = { ...DEFAULT_SETTINGS, ...(value.settings && typeof value.settings === 'object' ? value.settings : {}) };
    settings.scale = Math.min(1.25, Math.max(0.75, finite(settings.scale, 1)));
    settings.alwaysOnTop = Boolean(settings.alwaysOnTop);
    settings.inputLocked = Boolean(settings.inputLocked);
    settings.waterSound = Boolean(settings.waterSound);
    if (typeof settings.shortcut !== 'string' || !settings.shortcut || settings.shortcut.length > 80) settings.shortcut = DEFAULT_SETTINGS.shortcut;
    const activeHabitat = activeTank?.habitat === 'saltwater' ? 'saltwater' : 'freshwater';
    return { version: AQUARIUM_VERSION, activeHabitat, activeTankId: activeTank?.tankId || 'tank-1', nextTankNumber: nextTankNumber({ tankInstances }), visible: Boolean(value.visible), settings, ownedItemIds: owned, tankInstances, tanks };
  }

  function tankList(aquarium) {
    return Array.isArray(aquarium?.tankInstances) ? aquarium.tankInstances : [];
  }

  function tankById(aquarium, tankId) {
    return tankList(aquarium).find((tank) => tank.tankId === tankId) || null;
  }

  function activeTank(aquarium) {
    return tankById(aquarium, aquarium?.activeTankId) || tankList(aquarium)[0] || null;
  }

  function nextTankNumber(aquarium) {
    const numbers = tankList(aquarium).map((tank) => Number(String(tank.name || '').match(/(\d+)$/)?.[1] || 0));
    return Math.max(0, ...numbers) + 1;
  }

  function syncLegacyTanks(state) {
    const next = { ...state, tanks: { ...state.tanks } };
    for (const habitat of HABITATS) {
      const tank = tankList(state).find((candidate) => candidate.habitat === habitat);
      if (tank) next.tanks[habitat] = tank;
    }
    return next;
  }

  function resolveTank(state, payload = {}) {
    const requested = payload.tankId ? tankById(state, String(payload.tankId)) : null;
    if (requested) return requested;
    const habitat = HABITATS.includes(payload.habitat) ? payload.habitat : state.activeHabitat;
    return tankList(state).find((tank) => tank.habitat === habitat) || activeTank(state);
  }

  function displayedInventoryIds(aquarium) {
    return new Set(tankList(aquarium).flatMap((tank) => tank.fish || []).map((entry) => typeof entry === 'string' ? entry : entry.inventoryId));
  }

  function applyDisplayLocks(inventory, aquarium) {
    const displayed = displayedInventoryIds(aquarium);
    return (Array.isArray(inventory) ? inventory : []).map((entry) => ({ ...entry, displayLock: displayed.has(entry.inventoryId) }));
  }

  function result(ok, reason, snapshot, extra = {}) {
    return { ok, reason: reason || null, snapshot: clone(snapshot), ...extra };
  }

  function placeFish(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const tank = resolveTank(state, payload);
    const habitat = tank?.habitat || state.activeHabitat;
    if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state);
    const inventoryId = String(payload.inventoryId || '');
    const item = (Array.isArray(inventory) ? inventory : []).find((entry) => entry.inventoryId === inventoryId);
    if (!item) return result(false, 'inventory-missing', state);
    if (habitatForInventory(item) !== habitat) return result(false, 'wrong-habitat', state);
    if (displayedInventoryIds(state).has(inventoryId)) return result(false, 'already-displayed', state);
    if (!tank) return result(false, 'tank-missing', state);
    const limits = limitsFor(catalog);
    if (tank.fish.length >= limits.maxFishCount) return result(false, 'count-full', state);
    const currentLoad = tank.fish.reduce((sum, entry) => sum + fishMetrics((Array.isArray(inventory) ? inventory : []).find((candidate) => candidate.inventoryId === entry.inventoryId)).bioload, 0);
    const metrics = fishMetrics(item);
    if (currentLoad + metrics.bioload > limits.bioloadCapacity) return result(false, 'bioload-full', state, { requiredBioload: metrics.bioload, availableBioload: limits.bioloadCapacity - currentLoad });
    const next = clone(state);
    const target = next.tankInstances.find((entry) => entry.tankId === tank.tankId);
    const previousFishCount = target.fish.length;
    const previousDecorCount = target.decor.length;
    const boundSkinId = target.skinId;
    target.fish.push({ inventoryId, lane: LANES.includes(payload.lane) ? payload.lane : 'middle', motionSeed: stableSeed(inventoryId) });
    const synced = syncLegacyTanks(next);
    return result(true, null, synced, { inventoryId, habitat, tankId: tank.tankId, metrics });
  }

  function removeFish(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const inventoryId = String(payload.inventoryId || '');
    const tank = tankList(state).find((candidate) => candidate.fish.some((entry) => entry.inventoryId === inventoryId)
      && (!payload.tankId || candidate.tankId === String(payload.tankId)));
    if (!tank) return result(false, 'not-displayed', state);
    const next = clone(state);
    const target = next.tankInstances.find((entry) => entry.tankId === tank.tankId);
    target.fish = target.fish.filter((entry) => entry.inventoryId !== inventoryId);
    const synced = syncLegacyTanks(next);
    return result(true, null, synced, { inventoryId, habitat: tank.habitat, tankId: tank.tankId });
  }

  function switchHabitat(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const habitat = payload.habitat;
    if (!HABITATS.includes(habitat)) return result(false, 'invalid-habitat', state);
    if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state);
    if (habitat === state.activeHabitat) return result(true, null, state, { habitat });
    const target = tankList(state).find((tank) => tank.habitat === habitat);
    return result(true, null, { ...state, activeHabitat: habitat, activeTankId: target?.tankId || state.activeTankId }, { habitat, tankId: target?.tankId });
  }

  function switchTank(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const tank = tankById(state, String(payload.tankId || ''));
    if (!tank) return result(false, 'tank-missing', state);
    if (tank.habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state);
    return result(true, null, { ...state, activeTankId: tank.tankId, activeHabitat: tank.habitat }, { tankId: tank.tankId, habitat: tank.habitat });
  }

  function setTankHabitat(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const tank = tankById(state, String(payload.tankId || ''));
    const habitat = payload.habitat;
    if (!tank) return result(false, 'tank-missing', state);
    if (!HABITATS.includes(habitat)) return result(false, 'invalid-habitat', state);
    if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state);
    const next = clone(state);
    const target = next.tankInstances.find((entry) => entry.tankId === tank.tankId);
    const previousFishCount = target.fish.length;
    const previousDecorCount = target.decor.length;
    const boundSkinId = target.skinId;
    target.habitat = habitat;
    target.fish = target.fish.filter((entry) => {
      const item = (Array.isArray(inventory) ? inventory : []).find((candidate) => candidate.inventoryId === entry.inventoryId);
      return habitatForInventory(item) === habitat;
    });
    const checked = validateLayout(target, habitat, [...next.ownedItemIds, boundSkinId], catalog);
    if (checked.valid) Object.assign(target, checked.layout);
    else {
      const fallback = defaultTank(habitat, catalog);
      target.skinId = boundSkinId || fallback.skinId; target.backgroundId = fallback.backgroundId;
      target.substrateId = fallback.substrateId; target.effectId = fallback.effectId; target.decor = fallback.decor;
    }
    const synced = syncLegacyTanks(next);
    return result(true, null, { ...synced, activeTankId: target.tankId, activeHabitat: habitat }, { tankId: target.tankId, habitat, removedFishCount: previousFishCount - target.fish.length, removedDecorCount: previousDecorCount - target.decor.length });
  }

  function purchaseItem(input, wallet, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const item = catalogMap(catalog).get(payload.itemId);
    const price = item?.slot === 'skin' ? Math.max(0, Number(item.purchasePriceCoins ?? item.priceCoins)) : Number(item?.priceCoins);
    if (!item || price < 0 || (price === 0 && item.slot !== 'skin')) return result(false, 'not-purchasable', state, { wallet: clone(wallet) });
    if (item.slot !== 'skin' && state.ownedItemIds.includes(item.id)) return result(false, 'already-owned', state, { wallet: clone(wallet) });
    const habitat = HABITATS.includes(payload.habitat) ? payload.habitat : state.activeHabitat;
    if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state, { wallet: clone(wallet) });
    if (!habitatMatches(item.habitat, habitat)) return result(false, 'wrong-habitat', state, { wallet: clone(wallet) });
    const normalizedWallet = {
      balance: Math.max(0, Math.floor(finite(wallet?.balance))),
      totalEarned: Math.max(0, Math.floor(finite(wallet?.totalEarned))),
      totalSpent: Math.max(0, Math.floor(finite(wallet?.totalSpent)))
    };
    if (normalizedWallet.balance < price) return result(false, 'insufficient-coins', state, { wallet: normalizedWallet, cost: price });
    if (item.slot === 'skin') {
      const habitat = HABITATS.includes(payload.habitat) ? payload.habitat : state.activeHabitat;
      if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state, { wallet: normalizedWallet });
      const number = Number(state.nextTankNumber) || nextTankNumber(state);
      const tankId = `tank-${number}`;
      const tank = { tankId, name: `鱼缸${number}`, habitat, ...defaultTank(habitat, catalog), skinId: item.id };
      const next = syncLegacyTanks({ ...state, activeTankId: tankId, activeHabitat: habitat, nextTankNumber: number + 1, tankInstances: [...tankList(state), tank] });
      const nextWallet = { ...normalizedWallet, balance: normalizedWallet.balance - price, totalSpent: normalizedWallet.totalSpent + price };
      return result(true, null, next, { wallet: nextWallet, cost: price, itemId: item.id, createdTankId: tankId, tank });
    }
    const next = { ...state, ownedItemIds: [...state.ownedItemIds, item.id] };
    const nextWallet = { ...normalizedWallet, balance: normalizedWallet.balance - price, totalSpent: normalizedWallet.totalSpent + price };
    return result(true, null, next, { wallet: nextWallet, cost: price, itemId: item.id });
  }

  function saveLayout(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const tank = resolveTank(state, payload);
    const habitat = tank?.habitat || (HABITATS.includes(payload.habitat) ? payload.habitat : state.activeHabitat);
    if (habitat === 'saltwater' && !saltwaterUnlocked(ownedPacks)) return result(false, 'habitat-locked', state);
    const targetForLayout = resolveTank(state, payload);
    const requestedLayout = { ...(payload.layout || {}), skinId: targetForLayout?.skinId || payload.layout?.skinId };
    const layoutOwned = [...state.ownedItemIds, targetForLayout?.skinId].filter(Boolean);
    const checked = validateLayout(requestedLayout, habitat, layoutOwned, catalog);
    if (!checked.valid) return result(false, 'invalid-layout', state, { errors: checked.errors, metrics: checked.metrics });
    const next = clone(state);
    const target = next.tankInstances.find((entry) => entry.tankId === tank?.tankId) || next.tankInstances.find((entry) => entry.habitat === habitat);
    if (!target) return result(false, 'tank-missing', state);
    next.tankInstances[next.tankInstances.indexOf(target)] = { ...target, ...checked.layout, skinId: target.skinId, fish: target.fish };
    return result(true, null, syncLegacyTanks(next), { habitat, tankId: target.tankId, metrics: checked.metrics });
  }

  function setSetting(input, inventory, ownedPacks, payload = {}, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : payload;
    const allowed = new Set([...Object.keys(DEFAULT_SETTINGS), 'visible']);
    if (!patch || Object.keys(patch).some((key) => !allowed.has(key))) return result(false, 'invalid-setting', state);
    const nextSettings = { ...state.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'visible') {
        if (typeof value !== 'boolean') return result(false, 'invalid-setting', state);
      } else if (key === 'scale') {
        if (!Number.isFinite(Number(value)) || Number(value) < 0.75 || Number(value) > 1.25) return result(false, 'invalid-setting', state);
        nextSettings.scale = Number(value);
      } else if (key === 'shortcut') {
        if (typeof value !== 'string' || !value.trim() || value.length > 80) return result(false, 'invalid-setting', state);
        nextSettings.shortcut = value.trim();
      } else {
        if (typeof value !== 'boolean') return result(false, 'invalid-setting', state);
        nextSettings[key] = value;
      }
    }
    return result(true, null, { ...state, visible: Object.hasOwn(patch, 'visible') ? patch.visible : state.visible, settings: nextSettings });
  }

  function setVisibility(input, inventory, ownedPacks, visible, catalog = DEFAULT_CATALOG) {
    const state = normalizeAquariumState(input, inventory, ownedPacks, catalog);
    return result(true, null, { ...state, visible: Boolean(visible) });
  }

  function validateCatalog(catalog = DEFAULT_CATALOG) {
    const errors = [];
    const ids = new Set();
    const items = catalogItems(catalog);
    const categoryContract = {
      tank: { slot: 'skin', layers: ['frame'] },
      substrate: { slot: 'substrate', layers: ['substrate'] },
      rock: { slot: 'decor', layers: ['back', 'mid', 'front'] },
      plant: { slot: 'decor', layers: ['back', 'mid', 'front'] },
      wood: { slot: 'decor', layers: ['back', 'mid', 'front'] },
      background: { slot: 'background', layers: ['background'] },
      effect: { slot: 'effect', layers: ['effect', 'lighting'] }
    };
    if (!items.length) errors.push('catalog-empty');
    for (const item of items) {
      if (!item?.id || ids.has(item.id)) errors.push('duplicate-or-missing-id');
      ids.add(item?.id);
      const contract = categoryContract[item?.category];
      if (!contract) errors.push(`${item?.id}:category`);
      if (![...HABITATS, 'both'].includes(item?.habitat)) errors.push(`${item?.id}:habitat`);
      for (const key of ['priceCoins', 'load']) if (!Number.isFinite(Number(item?.[key])) || Number(item[key]) < 0) errors.push(`${item?.id}:${key}`);
      if (item?.slot === 'skin' && (!Number.isFinite(Number(item?.purchasePriceCoins ?? item?.priceCoins)) || Number(item.purchasePriceCoins ?? item.priceCoins) <= 0)) errors.push(`${item?.id}:purchasePriceCoins`);
      if (!item?.layer || !item?.anchor || !item?.slot || !item?.footprint || typeof item?.mirrorable !== 'boolean' || typeof item?.animated !== 'boolean') errors.push(`${item?.id}:contract`);
      if (contract && (item.slot !== contract.slot || !contract.layers.includes(item.layer))) errors.push(`${item?.id}:slot-layer`);
      const width = Number(item?.footprint?.width); const height = Number(item?.footprint?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0
        || (item?.slot === 'decor' && (width <= 0 || height <= 0))) errors.push(`${item?.id}:footprint`);
      if (!['frame', 'bottom', 'bottom-center', 'fill'].includes(item?.anchor)) errors.push(`${item?.id}:anchor`);
      if (typeof item?.asset !== 'string' || !item.asset.startsWith('assets/aquarium/catalog/') || item.asset.includes('..') || !item.asset.endsWith('.png')) errors.push(`${item?.id}:asset`);
    }
    for (const id of Array.isArray(catalog?.starterItemIds) ? catalog.starterItemIds : []) {
      const starter = items.find((item) => item.id === id);
      if (!starter || Number(starter.priceCoins) !== 0) errors.push(`${id}:invalid-starter`);
    }
    return { valid: errors.length === 0, errors, itemCount: catalogItems(catalog).length };
  }

  const api = {
    AQUARIUM_VERSION, HABITATS, LANES, SIZE_CLASSES, DEFAULT_LIMITS, DEFAULT_VIEWPORT, DEFAULT_SETTINGS,
    DEFAULT_CATALOG, createInitialAquariumState, defaultTank, normalizeAquariumState, validateCatalog, validateLayout,
    habitatForInventory, saltwaterUnlocked, stableSeed, sizeClassForFish, fishMetrics,
    displayedInventoryIds, applyDisplayLocks, snapCoordinate, placeFish, removeFish, switchHabitat,
    purchaseItem, saveLayout, setSetting, setVisibility, switchTank, setTankHabitat,
    tankList, tankById, activeTank, nextTankNumber, limitsFor, viewportFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondAquariumState = api;
})(typeof window !== 'undefined' ? window : globalThis);
