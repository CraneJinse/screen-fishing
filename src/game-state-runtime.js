(function exposeRuntimeGameState(globalScope) {
  'use strict';

  const catalog = typeof module !== 'undefined' && module.exports
    ? require('./game-state')
    : globalScope.PondGame;
  const probability = typeof module !== 'undefined' && module.exports ? require('./probability-system') : globalScope.PondProbability;
  const variants = typeof module !== 'undefined' && module.exports ? require('./fish-variants') : globalScope.PondVariants;
  const specialEvents = typeof module !== 'undefined' && module.exports ? require('./special-events') : globalScope.PondSpecialEvents;
  const achievementSystem = typeof module !== 'undefined' && module.exports ? require('./achievement-system') : globalScope.PondAchievements;
  const aquariumState = catalog.aquariumState || (typeof module !== 'undefined' && module.exports ? require('./aquarium-state') : globalScope.PondAquariumState);
  const RARITY_BASE_VALUES = Object.freeze({ common: 20, rare: 60, epic: 180, legendary: 600, mythic: 2400 });
  const PACK_MULTIPLIERS = Object.freeze({ F1: 1, F2: 1.08, S1: 1.16, S2: 1.25 });
  const PACK_HABITATS = Object.freeze({ F1: 'freshwater', F2: 'freshwater', S1: 'saltwater', S2: 'saltwater' });
  const HABITATS = Object.freeze({ freshwater: '淡水', saltwater: '咸水' });
  function speciesValueModifier(fishId) {
    const number = Math.max(1, Number.parseInt(String(fishId).replace(/\D/g, ''), 10) || 1);
    return 0.94 + ((number * 37) % 13) / 100;
  }
  function fishBaseValue(fish) {
    return Math.max(1, Math.round(RARITY_BASE_VALUES[fish.rarity] * PACK_MULTIPLIERS[fish.pack] * speciesValueModifier(fish.id)));
  }
  const FISH = catalog.FISH.map((fish) => ({ ...fish, locked: false, baseValueCoins: fishBaseValue(fish) }));
  const PACKS = catalog.PACKS;
  const RARITIES = catalog.RARITIES;
  const rarityNames = catalog.rarityNames;
  const PACK_ORDER = Object.freeze(['F1', 'F2', 'S1', 'S2']);
  const PACK_PRICES = Object.freeze({ F1: 0, F2: 4000, S1: 6000, S2: 8000 });
  const PACK_PREREQUISITES = Object.freeze({ F1: null, F2: 'F1', S1: 'F2', S2: 'S1' });
  const PACK_DEFINITIONS = Object.freeze(Object.fromEntries(PACK_ORDER.map((id) => {
    return [id, Object.freeze({
      id, name: PACKS[id], habitat: PACK_HABITATS[id], starter: id === 'F1',
      priceCoins: PACK_PRICES[id], prerequisitePack: PACK_PREREQUISITES[id]
    })];
  })));
  const AUTO_CAST_ROD_ID = 'auto-cast-rod';
  const BAIT_ORDER = Object.freeze(['bait-fresh', 'bait-moon', 'bait-star']);
  const EQUIPMENT_ORDER = Object.freeze([AUTO_CAST_ROD_ID, ...BAIT_ORDER]);
  const EQUIPMENT_DEFINITIONS = Object.freeze({
    [AUTO_CAST_ROD_ID]: Object.freeze({
      id: AUTO_CAST_ROD_ID, name: '自动抛竿鱼竿', type: 'rod', priceCoins: 1000,
      prerequisiteId: null, icon: 'auto-cast-rod.svg',
      description: '收杆完成后自动再次抛竿，可在设置中关闭。'
    }),
    'bait-fresh': Object.freeze({
      id: 'bait-fresh', name: '鲜香饵团', type: 'bait', priceCoins: 2000,
      prerequisiteId: null, icon: 'bait-fresh.svg',
      description: '明显减少普通鱼，提高稀有鱼与异色鱼概率。'
    }),
    'bait-moon': Object.freeze({
      id: 'bait-moon', name: '月光磷虾', type: 'bait', priceCoins: 5000,
      prerequisiteId: 'bait-fresh', icon: 'bait-moon.svg',
      description: '进一步提高稀有鱼、纯金与炫彩鱼概率。'
    }),
    'bait-star': Object.freeze({
      id: 'bait-star', name: '星虹秘饵', type: 'bait', priceCoins: 10000,
      prerequisiteId: 'bait-moon', icon: 'bait-star.svg',
      description: '最高等级钓饵，大幅提高高稀有度和异色概率。'
    })
  });
  const STATES = [
    'idle', 'casting', 'waiting', 'bite_intro', 'bite_loop', 'bite_urgent', 'bite_ready',
    'reel_pull', 'catch_flight', 'catch_land', 'celebrating', 'escaping',
    'sad_recover', 'empty_reel'
  ];
  const SAVE_SCHEMA_VERSION = 14;
  const PROBABILITY_VERSION = probability.PROBABILITY_VERSION || 2;
  const VARIANT_VERSION = 1;
  const ECONOMY_VERSION = 2;
  const HISTORY_LIMIT = 1000;
  const BITE_DURATION_MS = 30000;
  const URGENT_DURATION_MS = 6000;
  const ACTION_DURATIONS = Object.freeze({
    casting: 960, bite_intro: 900, reel_pull: 960, catch_flight: 1200,
    catch_land: 720, escaping: 960, sad_recover: 1200, empty_reel: 840,
    celebrate_common: 1200, celebrate_rare: 1600, celebrate_epic: 1600,
    celebrate_legendary: 1600, celebrate_mythic: 1600
  });
  const defaultSettings = Object.freeze({
    muted: true, sounds: false, alwaysOnTop: true, launchAtLogin: false,
    petScale: 1,
    petShortcut: 'CommandOrControl+Shift+M', panelShortcut: 'CommandOrControl+Shift+F',
    fishingShortcut: 'CommandOrControl+Shift+Space', showCastTimer: true, autoCastEnabled: false
  });
  const ACHIEVEMENTS = achievementSystem.ACHIEVEMENTS;
  const ACHIEVEMENT_SERIES = achievementSystem.ACHIEVEMENT_SERIES;
  achievementSystem.configure(FISH, specialEvents.REGISTRY);

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function createStats() {
    return {
      totalCatchCount: 0,
      uniqueSpeciesCount: 0,
      rarity: Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])),
      packs: Object.fromEntries(Object.keys(PACKS).map((pack) => [pack, 0])),
      packUnique: Object.fromEntries(Object.keys(PACKS).map((pack) => [pack, 0])),
      largestLengthCm: 0,
      largestWeightKg: 0,
      escapeCount: 0,
      distinctStreak: 0,
      bestDistinctStreak: 0,
      lastCaughtFishId: null
    };
  }

  function createInitialState(now = Date.now()) {
    return {
      version: SAVE_SCHEMA_VERSION,
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      probabilityVersion: PROBABILITY_VERSION,
      animationVersion: 1,
      measurementVersion: 5,
      economyVersion: ECONOMY_VERSION,
      fishingState: 'idle',
      stateStartedAt: now,
      stateEndsAt: null,
      biteDeadlineAt: null,
      catchCommitAt: null,
      catchCommitted: false,
      firstCast: true,
      castWaitDurationMs: null,
      introductoryCast: false,
      castCount: 0,
      catches: 0,
      pendingCatch: null,
      pity: { alternatePlusMisses: 0, goldenPlusMisses: 0, iridescentMisses: 0 },
      specialEventPity: { nonSpecialStreak: 0, duplicateSpecialStreak: 0, nextSpecialAt: null },
      specialEventCollection: { schemaVersion: 1, entries: {} },
      currentResult: null,
      collection: {},
      history: [],
      inventory: [],
      wallet: { balance: 0, totalEarned: 0, totalSpent: 0 },
      ownedPacks: ['F1'],
      equipment: { ownedIds: [], activeBaitId: null },
      castBaitId: null,
      autoCastPending: false,
      activeHabitat: 'freshwater',
      aquarium: aquariumState ? aquariumState.createInitialAquariumState() : null,
      achievements: [],
      achievementTimes: {},
      achievementVersion: 2, achievementData: achievementSystem.createData(), achievementMetadata: {}, achievementArchive: {},
      achievementTracking: [], achievementTitles: [], achievementTitleId: '', achievementNotice: null,
      stats: createStats(),
      settings: { ...defaultSettings },
      isPaused: false,
      pausedTimers: null,
      lastMessage: '准备好就抛竿吧。',
      lastUpdated: now,
      cornerCasts: {}, castTimerStartedAt: null, castTimerElapsedMs: 0
    };
  }

  function formatWeight(weightKg) {
    const grams = Math.max(0.001, weightKg * 1000);
    if (grams < 1) return `${Math.round(grams * 1000)} mg`;
    if (grams < 100) return `${grams.toFixed(1)} g`;
    if (grams < 1000) return `${Math.round(grams)} g`;
    return `${weightKg.toFixed(2)} kg`;
  }

  function personalRecordSummary(state) {
    const longestCm = Number(state?.stats?.largestLengthCm);
    const heaviestKg = Number(state?.stats?.largestWeightKg);
    return {
      longest: Number.isFinite(longestCm) && longestCm > 0 ? `${longestCm.toFixed(1)} cm` : '—',
      heaviest: Number.isFinite(heaviestKg) && heaviestKg > 0 ? formatWeight(heaviestKg) : '—'
    };
  }

  function parseDisplayedWeight(weight) {
    if (typeof weight !== 'string') return null;
    const parsed = Number.parseFloat(weight);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    if (/\bmg\b/i.test(weight)) return parsed / 1_000_000;
    return /\bg\b/i.test(weight) && !/\bkg\b/i.test(weight) ? parsed / 1000 : parsed;
  }

  function mapLegacyState(state) {
    return ({ bite: 'bite_loop', reeling: 'reel_pull', result: 'catch_land' })[state]
      || (STATES.includes(state) ? state : 'idle');
  }

  function normalizeHistoryEntry(entry, index, now) {
    if (!entry || entry.type !== 'fish' || !FISH.some((fish) => fish.id === entry.resultId)) return null;
    const fish = FISH.find((item) => item.id === entry.resultId);
    const lengthCm = Math.max(0.1, finite(entry.lengthCm, parseFloat(entry.size) || 10));
    const hasExplicitWeightKg = entry.weightKg !== null && entry.weightKg !== undefined && entry.weightKg !== '';
    const explicitWeightKg = Number(entry.weightKg);
    let weightKg = hasExplicitWeightKg && Number.isFinite(explicitWeightKg) && explicitWeightKg >= 0
      ? explicitWeightKg
      : finite(parseDisplayedWeight(entry.weight), 0.1);
    // Preserve sub-gram species. 0.001 here means kilograms (1 g), so using it
    // as the lower clamp silently rewrote legitimate 0.12 g fish to 1 g on
    // every history normalization pass.
    weightKg = Math.max(1e-9, weightKg);
    const catchId = String(entry.catchId || entry.id || `legacy-${now}-${index}-${entry.resultId}`);
    return {
      ...entry, catchId, id: catchId, at: finite(entry.at, now), resultId: fish.id,
      name: String(entry.name || fish.name), type: 'fish', rarity: fish.rarity,
      rarityName: fish.rarityName, pack: fish.pack, packName: fish.packName,
      lengthCm, weightKg, size: `${lengthCm.toFixed(1)} cm`, weight: formatWeight(weightKg),
      first: Boolean(entry.first), recordLength: Boolean(entry.recordLength),
      recordWeight: Boolean(entry.recordWeight), measurementVersion: finite(entry.measurementVersion, 1),
      variant: variants.normalizeVariant(entry.variant), variantVersion: finite(entry.variantVersion, 1), probabilityVersion: finite(entry.probabilityVersion, 1),
      valueCoins: entry.valueCoins != null && Number.isFinite(Number(entry.valueCoins)) ? Math.max(1, Math.round(Number(entry.valueCoins))) : null,
      soldAt: entry.soldAt == null ? null : Math.max(0, finite(entry.soldAt))
    };
  }

  function deriveStats(collection, _history, oldStats) {
    const stats = createStats();
    for (const [fishId, record] of Object.entries(collection)) {
      const fish = FISH.find((item) => item.id === fishId);
      if (!fish) continue;
      const count = Math.max(0, finite(record.count));
      if (count > 0) {
        stats.totalCatchCount += count;
        stats.uniqueSpeciesCount += 1;
        stats.rarity[fish.rarity] += count;
        stats.packs[fish.pack] += count;
        stats.packUnique[fish.pack] += 1;
      }
      stats.largestLengthCm = Math.max(stats.largestLengthCm, finite(record.maxLengthCm, record.maxSize));
      stats.largestWeightKg = Math.max(stats.largestWeightKg, finite(record.maxWeightKg, record.maxWeight));
    }
    stats.totalCatchCount = Math.max(stats.totalCatchCount, finite(oldStats?.totalCatchCount));
    stats.uniqueSpeciesCount = Math.max(stats.uniqueSpeciesCount, finite(oldStats?.uniqueSpeciesCount));
    for (const rarity of RARITIES) stats.rarity[rarity] = Math.max(stats.rarity[rarity], finite(oldStats?.rarity?.[rarity]));
    for (const pack of Object.keys(PACKS)) {
      stats.packs[pack] = Math.max(stats.packs[pack], finite(oldStats?.packs?.[pack]));
      stats.packUnique[pack] = Math.max(stats.packUnique[pack], finite(oldStats?.packUnique?.[pack]));
    }
    stats.largestLengthCm = Math.max(stats.largestLengthCm, finite(oldStats?.largestLengthCm));
    stats.largestWeightKg = Math.max(stats.largestWeightKg, finite(oldStats?.largestWeightKg));
    stats.escapeCount = Math.max(0, finite(oldStats?.escapeCount));
    stats.distinctStreak = Math.max(0, finite(oldStats?.distinctStreak));
    stats.bestDistinctStreak = Math.max(stats.distinctStreak, finite(oldStats?.bestDistinctStreak));
    stats.lastCaughtFishId = typeof oldStats?.lastCaughtFishId === 'string' ? oldStats.lastCaughtFishId : null;
    return stats;
  }

  function normalizeInventoryEntry(entry, index, now) {
    if (!entry || typeof entry !== 'object') return null;
    const fishId = String(entry.fishId || entry.resultId || '');
    const fish = FISH.find((item) => item.id === fishId);
    if (!fish) return null;
    const inventoryId = String(entry.inventoryId || entry.catchId || entry.id || `legacy-inventory-${now}-${index}-${fishId}`);
    const hasExplicitWeightKg = entry.weightKg !== null && entry.weightKg !== undefined && entry.weightKg !== '';
    const explicitWeightKg = Number(entry.weightKg);
    const weightKg = Math.max(1e-9, hasExplicitWeightKg && Number.isFinite(explicitWeightKg) && explicitWeightKg >= 0
      ? explicitWeightKg
      : finite(parseDisplayedWeight(entry.weight), 0.1));
    const lengthCm = Math.max(0.1, finite(entry.lengthCm, Number.parseFloat(entry.size) || 10));
    return {
      inventoryId, catchId: String(entry.catchId || inventoryId), fishId, resultId: fishId,
      caughtAt: finite(entry.caughtAt, entry.at || now), at: finite(entry.caughtAt, entry.at || now),
      name: fish.name, rarity: fish.rarity, rarityName: fish.rarityName,
      pack: fish.pack, packName: fish.packName, lengthCm, weightKg,
      size: `${lengthCm.toFixed(1)} cm`, weight: formatWeight(weightKg),
      displayClass: entry.displayClass || 'medium',
      variant: variants.normalizeVariant(entry.variant), variantVersion: finite(entry.variantVersion, 1), probabilityVersion: finite(entry.probabilityVersion, 1),
      locked: Boolean(entry.locked) || Boolean(entry.autoLocked), autoLocked: Boolean(entry.autoLocked), displayLock: Boolean(entry.displayLock),
      valueCoins: entry.valueCoins != null && Number.isFinite(Number(entry.valueCoins)) ? Math.max(1, Math.round(Number(entry.valueCoins))) : null,
      measurementVersion: finite(entry.measurementVersion, 1)
    };
  }

  function inventoryFromHistory(history) {
    return history.filter((entry) => entry.soldAt == null).map((entry) => normalizeInventoryEntry({
      ...entry, inventoryId: entry.catchId, fishId: entry.resultId, caughtAt: entry.at
    }, 0, entry.at)).filter(Boolean);
  }

  function normalizeOwnedPacks(value) {
    const valid = (Array.isArray(value) ? value : []).filter((pack) => PACK_DEFINITIONS[pack]);
    const furthest = valid.reduce((index, pack) => Math.max(index, PACK_ORDER.indexOf(pack)), 0);
    return PACK_ORDER.slice(0, furthest + 1);
  }

  function normalizeEquipment(value) {
    const source = value && typeof value === 'object' ? value : {};
    const ownedSet = new Set((Array.isArray(source.ownedIds) ? source.ownedIds : []).filter((id) => EQUIPMENT_DEFINITIONS[id]));
    const ownedIds = EQUIPMENT_ORDER.filter((id) => ownedSet.has(id));
    const requestedBait = probability.normalizeBaitId(source.activeBaitId);
    return { ownedIds, activeBaitId: requestedBait && ownedSet.has(requestedBait) ? requestedBait : null };
  }

  function normalizeState(value, now = Date.now()) {
    const base = createInitialState(now);
    if (!value || typeof value !== 'object') return base;
    const state = { ...base, ...value, version: SAVE_SCHEMA_VERSION, saveSchemaVersion: SAVE_SCHEMA_VERSION };
    state.economyVersion = Math.max(0, finite(value.economyVersion, 0));
    state.fishingState = mapLegacyState(value.fishingState);
    state.stateStartedAt = finite(value.stateStartedAt, now);
    state.stateEndsAt = value.stateEndsAt == null ? null : finite(value.stateEndsAt, null);
    state.biteDeadlineAt = value.biteDeadlineAt == null ? null : finite(value.biteDeadlineAt, null);
    state.catchCommitAt = value.catchCommitAt == null ? null : finite(value.catchCommitAt, null);
    state.catchCommitted = Boolean(value.catchCommitted);
    if (value.pendingCatch && typeof value.pendingCatch === 'object' && !Array.isArray(value.pendingCatch)) {
      const validVersion = (version) => Number.isSafeInteger(Number(version)) && Number(version) > 0;
      // Capture provenance before upgrading the enclosing state version. An
      // already selected catch must not be relabelled when it is landed.
      const selectedVersion = validVersion(value.pendingCatch.probabilityVersion) ? Number(value.pendingCatch.probabilityVersion)
        : validVersion(value.probabilityVersion) ? Number(value.probabilityVersion) : 1;
      state.pendingCatch = { ...value.pendingCatch, probabilityVersion: selectedVersion };
    }
    state.castTimerStartedAt = value.castTimerStartedAt == null ? null : finite(value.castTimerStartedAt, null);
    state.castTimerElapsedMs = Math.max(0, finite(value.castTimerElapsedMs, 0));
    state.castCount = Math.max(0, finite(value.castCount));
    state.catches = Math.max(0, finite(value.catches));
    state.firstCast = Object.hasOwn(value, 'firstCast') ? value.firstCast !== false : state.castCount < 1;
    state.castWaitDurationMs = value.castWaitDurationMs == null ? null : Math.max(0, finite(value.castWaitDurationMs));
    state.introductoryCast = value.introductoryCast === true && state.castCount === 1 && state.catches === 0;
    state.equipment = normalizeEquipment(value.equipment);
    const selectedCastBait = probability.normalizeBaitId(value.castBaitId);
    state.castBaitId = selectedCastBait && state.equipment.ownedIds.includes(selectedCastBait) ? selectedCastBait : null;
    if (state.pendingCatch) {
      const selectedCatchBait = probability.normalizeBaitId(state.pendingCatch.baitId);
      state.pendingCatch = { ...state.pendingCatch, baitId: selectedCatchBait && state.equipment.ownedIds.includes(selectedCatchBait) ? selectedCatchBait : null };
    }
    const storedSettings = value.settings && typeof value.settings === 'object' ? value.settings : {};
    state.settings = Object.fromEntries(Object.entries(defaultSettings).map(([key, fallback]) => [
      key, Object.hasOwn(storedSettings, key) ? storedSettings[key] : fallback
    ]));
    state.settings.showCastTimer = Boolean(state.settings.showCastTimer);
    state.settings.autoCastEnabled = Boolean(state.settings.autoCastEnabled) && state.equipment.ownedIds.includes(AUTO_CAST_ROD_ID);
    state.settings.petScale = Math.min(1.35, Math.max(0.75, finite(state.settings.petScale, 1)));
    for (const key of ['petShortcut', 'panelShortcut', 'fishingShortcut']) {
      if (typeof state.settings[key] !== 'string' || state.settings[key].length > 80) state.settings[key] = defaultSettings[key];
    }
    state.autoCastPending = Boolean(value.autoCastPending) && state.settings.autoCastEnabled;
    state.collection = {};
    for (const [id, item] of Object.entries(value.collection || {})) {
      if (!FISH.some((fish) => fish.id === id)) continue;
      state.collection[id] = {
        count: Math.max(0, finite(item.count)), firstAt: finite(item.firstAt, now),
        lastAt: finite(item.lastAt, item.firstAt || now),
        maxLengthCm: Math.max(0, finite(item.maxLengthCm, item.maxSize)),
        maxWeightKg: Math.max(0, finite(item.maxWeightKg, item.maxWeight))
        ,variants: variants.variantStats(item.variants, item.count, {
          firstAt: finite(item.firstAt, now), maxLengthCm: finite(item.maxLengthCm, item.maxSize), maxWeightKg: finite(item.maxWeightKg, item.maxWeight)
        })
      };
    }
    const specialEntries = value.specialEventCollection?.entries && typeof value.specialEventCollection.entries === 'object' ? value.specialEventCollection.entries : {};
    state.specialEventCollection = { schemaVersion: 1, entries: {} };
    for (const [id, item] of Object.entries(specialEntries)) {
      if (!specialEvents.byId(id)) continue;
      const count = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(finite(item?.count))));
      if (!count) continue;
      state.specialEventCollection.entries[id] = { count, firstFoundAt: finite(item?.firstFoundAt, now), lastFoundAt: finite(item?.lastFoundAt, item?.firstFoundAt || now) };
    }
    const seen = new Set();
    state.history = (Array.isArray(value.history) ? value.history : [])
      .map((entry, index) => normalizeHistoryEntry(entry, index, now))
      .filter((entry) => entry && !seen.has(entry.catchId) && seen.add(entry.catchId))
      .slice(0, HISTORY_LIMIT);
    state.ownedPacks = normalizeOwnedPacks(value.ownedPacks);
    state.activeHabitat = HABITATS[value.activeHabitat] ? value.activeHabitat : 'freshwater';
    if (state.activeHabitat === 'saltwater' && !state.ownedPacks.some((pack) => PACK_HABITATS[pack] === 'saltwater')) state.activeHabitat = 'freshwater';
    const wallet = value.wallet && typeof value.wallet === 'object' ? value.wallet : {};
    state.wallet = {
      balance: Math.max(0, Math.floor(finite(wallet.balance))),
      totalEarned: Math.max(0, Math.floor(finite(wallet.totalEarned))),
      totalSpent: Math.max(0, Math.floor(finite(wallet.totalSpent)))
    };
    const inventorySource = Array.isArray(value.inventory) ? value.inventory : inventoryFromHistory(state.history);
    const seenInventory = new Set();
    state.inventory = inventorySource.map((entry, index) => normalizeInventoryEntry(entry, index, now))
      .filter((entry) => entry && !seenInventory.has(entry.inventoryId) && seenInventory.add(entry.inventoryId));
    if (aquariumState) {
      state.aquarium = aquariumState.normalizeAquariumState(value.aquarium, state.inventory, state.ownedPacks);
      state.inventory = aquariumState.applyDisplayLocks(state.inventory, state.aquarium);
    } else {
      state.aquarium = value.aquarium && typeof value.aquarium === 'object' ? { ...value.aquarium } : base.aquarium;
    }
    state.achievements = [...new Set(Array.isArray(value.achievements) ? value.achievements : [])]
      .filter((id) => ACHIEVEMENTS.some((achievement) => achievement.id === id));
    state.achievementTimes = value.achievementTimes && typeof value.achievementTimes === 'object' ? { ...value.achievementTimes } : {};
    const oldPity = value.pity || {};
    state.pity = {
      alternatePlusMisses: oldPity.alternatePlusMisses ?? oldPity.successfulSinceVariant ?? 0,
      goldenPlusMisses: oldPity.goldenPlusMisses ?? oldPity.successfulSinceGolden ?? 0,
      iridescentMisses: oldPity.iridescentMisses ?? oldPity.successfulSinceIridescent ?? 0
    };
    for (const key of Object.keys(base.pity)) state.pity[key] = Math.max(0, Math.floor(finite(state.pity[key])));
    state.specialEventPity = probability.normalizeSpecialPity(value.specialEventPity || {});
    if (state.specialEventPity.nonSpecialStreak > probability.NON_SPECIAL_STREAK_LIMIT) state.specialEventPity.nonSpecialStreak = probability.NON_SPECIAL_STREAK_LIMIT;
    if (state.specialEventPity.duplicateSpecialStreak > probability.DUPLICATE_SPECIAL_STREAK_LIMIT) state.specialEventPity.duplicateSpecialStreak = probability.DUPLICATE_SPECIAL_STREAK_LIMIT;
    state.probabilityVersion = PROBABILITY_VERSION; state.variantVersion = VARIANT_VERSION;
    state.cornerCasts = Object.fromEntries(achievementSystem.CORNERS.filter(id => Object.hasOwn(value.cornerCasts || {}, id)).map(id => [id, finite(value.cornerCasts[id], now)]));
    state.stats = deriveStats(state.collection, state.history, value.stats);
    state.catches = Math.max(state.catches, state.stats.totalCatchCount);
    state.isPaused = Boolean(value.isPaused || value.suspendedRemainingMs != null);
    state.pausedTimers = value.pausedTimers && typeof value.pausedTimers === 'object' ? { ...value.pausedTimers } : null;
    if (!state.pausedTimers && value.suspendedRemainingMs != null) {
      state.pausedTimers = { stateRemainingMs: Math.max(0, finite(value.suspendedRemainingMs)), biteRemainingMs: null, catchCommitRemainingMs: null };
    }
    if (state.fishingState === 'catch_land' && state.currentResult) state.catchCommitted = true;
    if (state.fishingState === 'catch_land' && !state.catchCommitted && state.catchCommitAt == null) state.catchCommitAt = now;
    delete state.suspendedRemainingMs;
    delete state.consecutiveCatches;
    const migrated = achievementSystem.migrate(state, value, now);
    return achievementSystem.evaluate(migrated, now, migrated._achievementMigration ? 'retroactive' : 'earned');
  }

  function durationFor(state, random = Math.random, timings = {}) {
    const cast = Math.max(1, Math.floor(finite(state.castCount)));
    if (cast === 1 && state.firstCast) return Math.max(0, 10000 - actionDuration(timings, 'cast', ACTION_DURATIONS.casting));
    if (cast <= 5) return 30000 + Math.floor(betaSample(random, 3, 3) * 60001);
    return 300000 + Math.floor(betaSample(random, 3, 3) * 300001);
  }

  function unitRandom(random) {
    const value = Number(random());
    return Number.isFinite(value) ? Math.min(1 - 1e-12, Math.max(1e-12, value)) : 0.5;
  }

  function gammaSample(random, shape) {
    if (shape < 1) return gammaSample(random, shape + 1) * Math.pow(unitRandom(random), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const normal = Math.sqrt(-2 * Math.log(unitRandom(random))) * Math.cos(Math.PI * 2 * unitRandom(random));
      const v0 = 1 + c * normal;
      if (v0 <= 0) continue;
      const v = v0 * v0 * v0;
      const u = unitRandom(random);
      if (u < 1 - 0.0331 * normal ** 4 || Math.log(u) < 0.5 * normal * normal + d * (1 - v + Math.log(v))) return d * v;
    }
    return Math.max(1e-9, d);
  }

  function betaSample(random, alpha, beta) {
    const left = gammaSample(random, Math.max(1, alpha));
    const right = gammaSample(random, Math.max(1, beta));
    return Math.min(1, Math.max(0, left / (left + right)));
  }
  function actionDuration(timings, actionId, fallback) {
    return Math.max(16, finite(timings?.[actionId]?.totalMs, fallback));
  }
  function actionFrameStart(timings, actionId, index, fallback) {
    return Math.max(0, finite(timings?.[actionId]?.frameStartMs?.[index], fallback));
  }

  function getAvailableFish(input, habitat) {
    const state = normalizeState(input);
    const activeHabitat = HABITATS[habitat] ? habitat : state.activeHabitat;
    const owned = new Set(state.ownedPacks);
    return FISH.filter((fish) => owned.has(fish.pack) && PACK_HABITATS[fish.pack] === activeHabitat);
  }

  function canSwitchHabitat(input, habitat) {
    if (!HABITATS[habitat]) return false;
    const state = normalizeState(input);
    return habitat === 'freshwater' || state.ownedPacks.some((pack) => PACK_HABITATS[pack] === habitat);
  }

  function switchHabitat(input, habitat, now = Date.now()) {
    const state = normalizeState(input, now);
    if (!HABITATS[habitat]) return { ok: false, reason: 'invalid-habitat', state };
    if (!canSwitchHabitat(state, habitat)) return { ok: false, reason: 'locked-habitat', state };
    if (!['idle', 'empty_reel'].includes(state.fishingState)) return { ok: false, reason: 'fishing-active', state };
    return { ok: true, state: { ...state, activeHabitat: habitat, lastUpdated: now, lastMessage: `已切换到${HABITATS[habitat]}垂钓场景。` } };
  }

  function pickResult(random = Math.random, source = 'F1') {
    const candidates = typeof source === 'string'
      ? FISH.filter((fish) => fish.pack === (PACKS[source] ? source : 'F1'))
      : Array.isArray(source) ? source : getAvailableFish(source);
    const roll = random();
    const rarity = roll < 0.62 ? 'common' : roll < 0.87 ? 'rare' : roll < 0.96 ? 'epic' : roll < 0.99 ? 'legendary' : 'mythic';
    const list = candidates.filter((fish) => fish.rarity === rarity);
    return list[Math.min(list.length - 1, Math.floor(random() * list.length))] || candidates[0] || FISH[0];
  }

  function pickEncounter(random = Math.random, state) {
    const available = getAvailableFish(state);
    if (state.introductoryCast) {
      const candidates = available.filter(fish => fish.rarity === 'common');
      const fish = candidates[Math.min(candidates.length - 1, Math.floor(unitRandom(random) * candidates.length))];
      if (fish) return { type: 'fish', encounterType: 'fish', packId: fish.pack, rarity: fish.rarity, fishId: fish.id, variant: 'normal', randomUnhook: false, baitId: state.castBaitId, probabilityVersion: PROBABILITY_VERSION, nextSpecialEventPity: probability.normalizeSpecialPity({ ...state.specialEventPity, nonSpecialStreak: state.specialEventPity.nonSpecialStreak + 1 }) };
    }
    return probability.encounter(random, { habitat: state.activeHabitat, unlockedPacks: [...new Set(available.map((fish) => fish.pack))], fish: available, specialEvents: specialEvents.runtimeRegistry(), counters: state.pity, specialEventPity: state.specialEventPity, collection: state.specialEventCollection.entries, baitId: state.castBaitId });
  }

  const achievementProgress = achievementSystem.achievementProgress;
  const achievementSummary = achievementSystem.achievementSummary;
  const achievementDetails = achievementSystem.achievementDetails;
  function unlockAchievements(input, now = Date.now()) { return achievementSystem.evaluate(input, now); }
  function applyAchievementAction(input, action, now = Date.now()) { return achievementSystem.applyAchievementAction(normalizeState(input, now), action); }

  function autoCastAvailable(state) {
    return Boolean(state?.settings?.autoCastEnabled)
      && Array.isArray(state?.equipment?.ownedIds)
      && state.equipment.ownedIds.includes(AUTO_CAST_ROD_ID);
  }

  function startCast(state, random = Math.random, now = Date.now(), payload = {}, timings = {}) {
    const next = {
      ...state,
      fishingState: 'casting', stateStartedAt: now,
      stateEndsAt: now + actionDuration(timings, 'cast', ACTION_DURATIONS.casting),
      castCount: state.castCount + 1,
      pendingCatch: null, currentResult: null, catchCommitAt: null, catchCommitted: false,
      biteDeadlineAt: null, autoCastPending: false,
      castBaitId: state.equipment.activeBaitId,
      lastUpdated: now
    };
    next.castWaitDurationMs = durationFor(next, random, timings);
    next.introductoryCast = state.firstCast && state.castCount === 0 && state.catches === 0;
    next.firstCast = false;
    next.castTimerStartedAt = now;
    next.castTimerElapsedMs = 0;
    next.lastMessage = '鱼线划过一小道弧线……';
    if (achievementSystem.CORNERS.includes(payload.corner)) next.cornerCasts = { ...next.cornerCasts, [payload.corner]: now };
    return unlockAchievements(next, now);
  }

  function finishFishingCycle(state, random = Math.random, now = Date.now(), timings = {}) {
    const idle = {
      ...state, fishingState: 'idle', stateStartedAt: now, stateEndsAt: null,
      pendingCatch: null, currentResult: null, catchCommitAt: null, catchCommitted: false,
      biteDeadlineAt: null, castBaitId: null, castTimerStartedAt: null, castTimerElapsedMs: 0,
      lastUpdated: now, lastMessage: '准备好就抛竿吧。'
    };
    return idle.autoCastPending && autoCastAvailable(idle) ? startCast(idle, random, now, {}, timings) : { ...idle, autoCastPending: false };
  }

  function transition(input, action, random = Math.random, now = Date.now(), payload = {}, timings = {}) {
    const state = normalizeState(input, now);
    if (state.isPaused) return state;
    const next = { ...state, lastUpdated: now };
    if (action === 'cast' && state.fishingState === 'idle') {
      return startCast(state, random, now, payload, timings);
    }
    if (action === 'reel' && ['bite_intro', 'bite_loop', 'bite_urgent', 'bite_ready'].includes(state.fishingState)) {
      const autoCastPending = autoCastAvailable(state);
      if (state.pendingCatch?.encounterType === 'fish' && state.pendingCatch?.randomUnhook) return { ...next, fishingState: 'empty_reel', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'empty_reel', ACTION_DURATIONS.empty_reel), pendingCatch: null, currentResult: { type: 'random_unhook', encounterType: 'fish', probabilityVersion: state.pendingCatch.probabilityVersion, fishId: state.pendingCatch.fishId, baitId: state.pendingCatch.baitId, iconPath: null, animationPath: null, at: now }, autoCastPending, biteDeadlineAt: null, castTimerStartedAt: null, castTimerElapsedMs: 0, lastMessage: '鱼线一松，鱼脱钩了……' };
      return { ...next, fishingState: 'reel_pull', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'reel_pull', ACTION_DURATIONS.reel_pull), biteDeadlineAt: null, catchCommitAt: null, catchCommitted: false, currentResult: null, autoCastPending, castTimerElapsedMs: next.castTimerStartedAt == null ? next.castTimerElapsedMs : Math.max(next.castTimerElapsedMs, now - next.castTimerStartedAt), castTimerStartedAt: null, lastMessage: '稳住，收杆！' };
    }
    if (action === 'early-reel' && ['waiting', 'casting'].includes(state.fishingState)) {
      return { ...next, fishingState: 'empty_reel', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'empty_reel', ACTION_DURATIONS.empty_reel), pendingCatch: null, autoCastPending: false, castBaitId: null, castTimerStartedAt: null, castTimerElapsedMs: 0, lastMessage: '提前收杆，没有收获也没关系。' };
    }
    if (action === 'dismiss-result' && ['catch_land', 'celebrating'].includes(state.fishingState)) {
      return finishFishingCycle(next, random, now, timings);
    }
    return state;
  }

  function tick(input, now = Date.now(), random = Math.random, measurementMap = {}, timings = {}) {
    const state = normalizeState(input, now);
    if (state.isPaused) return state;
    if (state.fishingState === 'catch_land' && !state.catchCommitted && state.catchCommitAt != null && now >= state.catchCommitAt) {
      return commitCatch(state, random, now, measurementMap);
    }
    if (!state.stateEndsAt || now < state.stateEndsAt) return state;
    if (state.fishingState === 'casting') return { ...state, fishingState: 'waiting', firstCast: false, stateStartedAt: now, stateEndsAt: now + (state.castWaitDurationMs ?? durationFor(state, random, timings)), lastUpdated: now, lastMessage: '鱼钩落水了，安静等一会儿。' };
    if (state.fishingState === 'waiting') {
      const encounter = pickEncounter(random, state);
      const fish = encounter.fishId ? FISH.find((item) => item.id === encounter.fishId) : null;
      if (encounter.encounterType === 'special') return { ...state, fishingState: 'bite_intro', pendingCatch: { encounterType: 'special', eventId: encounter.eventId, seriesId: encounter.seriesId, catchId: `special-${now}-${encounter.eventId}-${state.castCount}`, baitId: encounter.baitId, probabilityVersion: encounter.probabilityVersion, topLevelMode: encounter.topLevelMode, selectionMode: encounter.selectionMode, selectedAt: now }, specialEventPity: encounter.nextSpecialEventPity, stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'bite_intro', ACTION_DURATIONS.bite_intro), biteDeadlineAt: now + BITE_DURATION_MS, castTimerElapsedMs: state.castTimerStartedAt == null ? state.castTimerElapsedMs : Math.max(state.castTimerElapsedMs, now - state.castTimerStartedAt), castTimerStartedAt: null, lastUpdated: now, lastMessage: '发现了特别的东西！' };
      if (!fish) return { ...state, fishingState: 'waiting', stateStartedAt: now, stateEndsAt: now + durationFor(state, random), lastUpdated: now, lastMessage: '水面很安静，再等等。' };
      return {
        ...state, fishingState: 'bite_intro',
        pendingCatch: {
          encounterType: 'fish', fishId: fish.id, packId: encounter.packId, rarity: encounter.rarity, selectedAt: now, catchId: `catch-${now}-${fish.id}-${state.castCount}`,
          randomUnhook: encounter.randomUnhook, variant: encounter.variant, baitId: encounter.baitId, probabilityVersion: encounter.probabilityVersion,
          measurementRolls: [random(), random()]
        },
        specialEventPity: encounter.nextSpecialEventPity,
        stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'bite_intro', ACTION_DURATIONS.bite_intro),
        biteDeadlineAt: now + BITE_DURATION_MS, castTimerElapsedMs: state.castTimerStartedAt == null ? state.castTimerElapsedMs : Math.max(state.castTimerElapsedMs, now - state.castTimerStartedAt), castTimerStartedAt: null, lastUpdated: now,
        lastMessage: '中鱼！点击人物或小船收杆！'
      };
    }
    if (state.fishingState === 'bite_intro') {
      const deadline = state.biteDeadlineAt ?? now + BITE_DURATION_MS;
      return { ...state, fishingState: now >= deadline ? 'bite_ready' : 'bite_loop', stateStartedAt: now, stateEndsAt: now >= deadline ? null : deadline, biteDeadlineAt: now >= deadline ? null : deadline, lastUpdated: now, lastMessage: '已经上钩，随时可以收杆。' };
    }
    if (['bite_loop', 'bite_urgent'].includes(state.fishingState)) return { ...state, fishingState: 'bite_ready', stateStartedAt: now, stateEndsAt: null, biteDeadlineAt: null, lastUpdated: now, lastMessage: '已经上钩，随时可以收杆。' };
    if (state.fishingState === 'reel_pull') return { ...state, fishingState: 'catch_flight', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'catch_flight', ACTION_DURATIONS.catch_flight), lastUpdated: now };
    if (state.fishingState === 'catch_flight') {
      return {
        ...state, fishingState: 'catch_land', stateStartedAt: now,
        stateEndsAt: now + actionDuration(timings, 'catch_land', ACTION_DURATIONS.catch_land),
        catchCommitAt: now + actionFrameStart(timings, 'catch_land', 1, ACTION_DURATIONS.catch_land / 6),
        catchCommitted: false, lastUpdated: now
      };
    }
    if (state.fishingState === 'catch_land') {
      const rarity = state.currentResult?.rarity || 'common';
      return { ...state, fishingState: 'celebrating', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, `celebrate_${rarity}`, ACTION_DURATIONS[`celebrate_${rarity}`]), catchCommitAt: null, lastUpdated: now };
    }
    if (state.fishingState === 'celebrating') return finishFishingCycle(state, random, now, timings);
    if (state.fishingState === 'escaping') return { ...state, fishingState: 'sad_recover', stateStartedAt: now, stateEndsAt: now + actionDuration(timings, 'sad_recover', ACTION_DURATIONS.sad_recover), pendingCatch: null, lastUpdated: now };
    if (state.fishingState === 'sad_recover') return { ...state, fishingState: 'waiting', stateStartedAt: now, stateEndsAt: now + durationFor({ ...state, firstCast: false }, random), castTimerStartedAt: now, castTimerElapsedMs: 0, lastUpdated: now, lastMessage: '重新放好鱼线，继续安静等待。' };
    if (state.fishingState === 'empty_reel') return finishFishingCycle(state, random, now, timings);
    return state;
  }

  function standardNormal(random) {
    const u1 = unitRandom(random);
    const u2 = unitRandom(random);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function truncatedNormal(random, mean, min, max, sigma = (max - min) / 6) {
    if (!(max > min)) return min;
    const safeMean = Math.min(max, Math.max(min, finite(mean, (min + max) / 2)));
    const safeSigma = Math.max((max - min) / 1000, finite(sigma, (max - min) / 6));
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const value = safeMean + standardNormal(random) * safeSigma;
      if (value >= min && value <= max) return value;
    }
    return safeMean;
  }

  function fallbackMeasurement(fish) {
    const longNames = /鳗|鳝|带鱼|龙鱼|雀鳝|鲟|枪鱼|剑鱼|鲨|巨骨舌|水针|管吻/;
    const largeNames = /鲨|鲟|鲑|金枪|石斑|鲢|鲹|鲯鳅|鲤|翻车|蝠鲼|魟|巨骨舌|巨暹罗/;
    const tinyNames = /虾|螺|霓虹|蚂蚁灯|鳉|孔雀鱼|小精灵|迷你/;
    const flatNames = /魟|鲼|比目|燕鱼|神仙鱼|七彩|月亮鱼|翻车鱼/;
    if (tinyNames.test(fish.name)) return { min: 2, typical: 5, max: 12, minWeight: 0.001, typicalWeight: 0.008, maxWeight: 0.08, displayClass: 'tiny' };
    if (largeNames.test(fish.name)) return { min: 40, typical: 100, max: 260, minWeight: 2, typicalWeight: 18, maxWeight: 180, displayClass: flatNames.test(fish.name) ? 'flat' : 'large' };
    if (longNames.test(fish.name)) return { min: 25, typical: 65, max: 180, minWeight: 0.2, typicalWeight: 2.5, maxWeight: 35, displayClass: 'long' };
    if (flatNames.test(fish.name)) return { min: 12, typical: 28, max: 70, minWeight: 0.08, typicalWeight: 0.65, maxWeight: 6, displayClass: 'flat' };
    if (fish.pack.startsWith('S')) return { min: 10, typical: 32, max: 90, minWeight: 0.04, typicalWeight: 0.8, maxWeight: 12, displayClass: 'medium' };
    return { min: 5, typical: 18, max: 55, minWeight: 0.01, typicalWeight: 0.22, maxWeight: 4, displayClass: 'small' };
  }

  function measurementSource(fish, suppliedProfile) {
    if (!suppliedProfile?.lengthCm) return fallbackMeasurement(fish);
    const kilograms = suppliedProfile.weightKg;
    const weightScale = kilograms && Number(kilograms.typical) > 0 ? 1 : 0.001;
    const weightRange = weightScale === 1 ? kilograms : suppliedProfile.weightG;
    return {
      min: finite(suppliedProfile.lengthCm.min), typical: finite(suppliedProfile.lengthCm.typical), max: finite(suppliedProfile.lengthCm.max),
      minWeight: Math.max(1e-9, finite(weightRange?.min) * weightScale),
      typicalWeight: Math.max(1e-9, finite(weightRange?.typical) * weightScale),
      maxWeight: Math.max(1e-9, finite(weightRange?.max) * weightScale),
      massA: Number(suppliedProfile.massModel?.a), massB: Number(suppliedProfile.massModel?.b),
      noiseMin: Number(suppliedProfile.noise?.min), noiseMax: Number(suppliedProfile.noise?.max),
      displayClass: suppliedProfile.displayClass
    };
  }

  function weightForLength(source, lengthCm, random) {
    const ratio = Math.max(0.01, lengthCm / Math.max(0.001, source.typical));
    const modelKg = Number.isFinite(source.massA) && source.massA > 0 && Number.isFinite(source.massB) && source.massB > 0
      ? source.massA * Math.pow(lengthCm, source.massB) / 1000
      : source.typicalWeight * Math.pow(ratio, 3);
    const noiseMin = Number.isFinite(source.noiseMin) && source.noiseMin > 0 ? source.noiseMin : 0.9;
    const noiseMax = Number.isFinite(source.noiseMax) && source.noiseMax > noiseMin ? source.noiseMax : 1.1;
    const condition = truncatedNormal(random, 1, noiseMin, noiseMax, (noiseMax - noiseMin) / 4);
    return Math.min(source.maxWeight, Math.max(source.minWeight, modelKg * condition));
  }

  function preciseWeightKg(weightKg) {
    return Number(Math.max(1e-9, weightKg).toPrecision(5));
  }

  function generateMeasurement(fish, random = Math.random, suppliedProfile) {
    const source = measurementSource(fish, suppliedProfile);
    const lengthCm = truncatedNormal(random, source.typical, source.min, source.max, Math.max(0.001, (source.max - source.min) / 6));
    const weightKg = Math.min(source.maxWeight, Math.max(source.minWeight, preciseWeightKg(weightForLength(source, lengthCm, random))));
    const roundedLength = Math.min(source.max, Math.max(source.min, Number(lengthCm.toFixed(1))));
    return { lengthCm: roundedLength, weightKg, displayClass: source.displayClass || 'medium' };
  }

  function getFishBaseValue(fishOrId) {
    const fish = typeof fishOrId === 'string' ? FISH.find((item) => item.id === fishOrId) : fishOrId;
    return fish ? fish.baseValueCoins : 0;
  }

  function calculateCatchValue(fishOrId, measurement, suppliedProfile) {
    const fish = typeof fishOrId === 'string' ? FISH.find((item) => item.id === fishOrId) : fishOrId;
    if (!fish) return 0;
    const source = measurementSource(fish, suppliedProfile);
    const lengthRatio = Math.min(1.5, Math.max(0.5, finite(measurement?.lengthCm, source.typical) / Math.max(0.001, source.typical)));
    const weightRatio = Math.min(1.5, Math.max(0.5, finite(measurement?.weightKg, source.typicalWeight) / Math.max(1e-9, source.typicalWeight)));
    const sizeFactor = Math.min(1.22, Math.max(0.82, 0.65 + 0.2 * lengthRatio + 0.15 * weightRatio));
    return Math.max(1, Math.round(fish.baseValueCoins * sizeFactor));
  }

  function getPackPrice(packId) {
    return PACK_DEFINITIONS[packId]?.priceCoins ?? null;
  }

  function purchasePack(input, packId, now = Date.now()) {
    const state = normalizeState(input, now);
    const definition = PACK_DEFINITIONS[packId];
    if (!definition || definition.starter) return { ok: false, reason: 'not-purchasable', cost: definition?.priceCoins ?? 0, state };
    if (state.ownedPacks.includes(packId)) return { ok: false, reason: 'already-owned', cost: definition.priceCoins, state };
    if (definition.prerequisitePack && !state.ownedPacks.includes(definition.prerequisitePack)) {
      return { ok: false, reason: 'previous-pack-required', requiredPack: definition.prerequisitePack, cost: definition.priceCoins, state };
    }
    if (state.wallet.balance < definition.priceCoins) return { ok: false, reason: 'insufficient-funds', cost: definition.priceCoins, state };
    const next = {
      ...state,
      ownedPacks: [...state.ownedPacks, packId].sort((left, right) => PACK_ORDER.indexOf(left) - PACK_ORDER.indexOf(right)),
      wallet: { ...state.wallet, balance: state.wallet.balance - definition.priceCoins, totalSpent: state.wallet.totalSpent + definition.priceCoins },
      lastUpdated: now, lastMessage: `已解锁鱼包：${definition.name}。`
    };
    return { ok: true, cost: definition.priceCoins, packId, state: unlockAchievements(next, now) };
  }

  function purchaseEquipment(input, equipmentId, now = Date.now()) {
    const state = normalizeState(input, now);
    const definition = EQUIPMENT_DEFINITIONS[equipmentId];
    if (!definition) return { ok: false, reason: 'equipment-not-found', cost: 0, state };
    if (state.equipment.ownedIds.includes(equipmentId)) return { ok: false, reason: 'already-owned', cost: definition.priceCoins, state };
    if (definition.prerequisiteId && !state.equipment.ownedIds.includes(definition.prerequisiteId)) {
      return { ok: false, reason: 'equipment-prerequisite', requiredEquipment: definition.prerequisiteId, cost: definition.priceCoins, state };
    }
    if (state.wallet.balance < definition.priceCoins) return { ok: false, reason: 'insufficient-funds', cost: definition.priceCoins, state };
    const ownedIds = EQUIPMENT_ORDER.filter((id) => state.equipment.ownedIds.includes(id) || id === equipmentId);
    const equipment = { ...state.equipment, ownedIds };
    const settings = { ...state.settings };
    if (definition.type === 'bait') equipment.activeBaitId = equipmentId;
    if (equipmentId === AUTO_CAST_ROD_ID) settings.autoCastEnabled = true;
    return {
      ok: true, cost: definition.priceCoins, equipmentId,
      state: {
        ...state, equipment, settings,
        wallet: { ...state.wallet, balance: state.wallet.balance - definition.priceCoins, totalSpent: state.wallet.totalSpent + definition.priceCoins },
        lastUpdated: now, lastMessage: definition.type === 'bait' ? `已购买并使用${definition.name}。` : `已解锁${definition.name}。`
      }
    };
  }

  function equipBait(input, baitId, now = Date.now()) {
    const state = normalizeState(input, now);
    const normalized = probability.normalizeBaitId(baitId);
    if (baitId != null && !normalized) return { ok: false, reason: 'equipment-not-found', state };
    if (normalized && !BAIT_ORDER.includes(normalized)) return { ok: false, reason: 'not-bait', state };
    if (normalized && !state.equipment.ownedIds.includes(normalized)) return { ok: false, reason: 'equipment-not-owned', state };
    const name = normalized ? EQUIPMENT_DEFINITIONS[normalized].name : '不使用钓饵';
    return { ok: true, baitId: normalized, state: { ...state, equipment: { ...state.equipment, activeBaitId: normalized }, lastUpdated: now, lastMessage: `已切换为${name}。` } };
  }

  function sortInventory(input, mode = 'newest') {
    const inventory = Array.isArray(input) ? input : normalizeState(input).inventory;
    const orderByFish = new Map(PACK_ORDER.flatMap((pack) => FISH.filter((fish) => fish.pack === pack)).map((fish, index) => [fish.id, index]));
    const variantOrder = { iridescent: 0, golden: 1, alternate: 2, normal: 3 };
    return [...inventory].sort((left, right) => {
      if (mode === 'variant') {
        const variant = (variantOrder[variants.normalizeVariant(left.variant)] ?? 3) - (variantOrder[variants.normalizeVariant(right.variant)] ?? 3);
        if (variant) return variant;
        const species = finite(orderByFish.get(left.fishId), Number.MAX_SAFE_INTEGER) - finite(orderByFish.get(right.fishId), Number.MAX_SAFE_INTEGER);
        if (species) return species;
        const length = finite(left.lengthCm) - finite(right.lengthCm);
        if (length) return length;
        const weight = finite(left.weightKg) - finite(right.weightKg);
        if (weight) return weight;
        return finite(left.caughtAt, left.at) - finite(right.caughtAt, right.at) || String(left.inventoryId).localeCompare(String(right.inventoryId));
      }
      if (mode === 'catalog') {
        const species = finite(orderByFish.get(left.fishId), Number.MAX_SAFE_INTEGER) - finite(orderByFish.get(right.fishId), Number.MAX_SAFE_INTEGER);
        if (species) return species;
        const length = finite(left.lengthCm) - finite(right.lengthCm);
        if (length) return length;
        const weight = finite(left.weightKg) - finite(right.weightKg);
        if (weight) return weight;
      }
      return finite(right.caughtAt, right.at) - finite(left.caughtAt, left.at) || String(left.inventoryId).localeCompare(String(right.inventoryId));
    });
  }

  function sellInventory(input, inventoryIds, now = Date.now()) {
    const state = normalizeState(input, now);
    const ids = [...new Set((Array.isArray(inventoryIds) ? inventoryIds : [inventoryIds]).filter((id) => typeof id === 'string' && id))];
    if (!ids.length) return { ok: false, reason: 'empty-selection', earned: 0, sold: [], state };
    const byId = new Map(state.inventory.map((entry) => [entry.inventoryId, entry]));
    if (ids.some((id) => !byId.has(id))) return { ok: false, reason: 'inventory-not-found', earned: 0, sold: [], state };
    const requested = ids.map((id) => byId.get(id));
    const displayed = requested.filter((entry) => entry.displayLock);
    if (displayed.length && ids.length === 1) return { ok: false, reason: 'fish-in-aquarium', earned: 0, sold: [], excludedDisplay: displayed.map((entry) => entry.inventoryId), state };
    const sold = requested.filter((entry) => !entry.displayLock);
    if (!sold.length) return { ok: false, reason: 'display-fish-excluded', earned: 0, sold: [], excludedDisplay: displayed.map((entry) => entry.inventoryId), state };
    if (sold.some((entry) => variants.isProtected(entry))) return { ok: false, reason: 'protected-variant', earned: 0, sold: [], state };
    if (sold.some((entry) => !Number.isFinite(entry.valueCoins) || entry.valueCoins < 1)) return { ok: false, reason: 'inventory-not-valued', earned: 0, sold: [], state };
    const earned = sold.reduce((sum, entry) => sum + entry.valueCoins, 0);
    const soldIds = new Set(sold.map((entry) => entry.inventoryId));
    const soldCatchIds = new Set(sold.map((entry) => entry.catchId));
    const next = {
      ...state,
      achievementData: { ...state.achievementData, soldFishCount: state.achievementData.soldFishCount + sold.length },
      inventory: state.inventory.filter((entry) => !soldIds.has(entry.inventoryId)),
      history: state.history.map((entry) => soldCatchIds.has(entry.catchId) ? { ...entry, soldAt: now, saleValueCoins: entry.valueCoins } : entry),
      wallet: { ...state.wallet, balance: state.wallet.balance + earned, totalEarned: state.wallet.totalEarned + earned },
      lastUpdated: now, lastMessage: `出售 ${sold.length} 条鱼，获得 ${earned} 金币。`
    };
    return { ok: true, earned, sold, excludedDisplay: displayed.map((entry) => entry.inventoryId), state: unlockAchievements(next, now) };
  }

  function setInventoryLocked(input, inventoryId, locked, now = Date.now()) {
    const state = normalizeState(input, now);
    const id = String(inventoryId || '');
    if (!id || !state.inventory.some((entry) => entry.inventoryId === id)) return { ok: false, reason: 'inventory-not-found', state };
    const next = { ...state, inventory: state.inventory.map((entry) => entry.inventoryId === id ? { ...entry, locked: Boolean(locked), autoLocked: false } : entry), lastUpdated: now };
    return { ok: true, inventoryId: id, locked: Boolean(locked), state: next };
  }

  function repairLegacyMeasurements(input, measurementMap = {}) {
    const state = normalizeState(input);
    const repairedByFish = {};
    const history = state.history.map((entry) => {
      const fish = FISH.find((item) => item.id === entry.resultId);
      if (!fish) return entry;
      let seed = [...String(entry.catchId)].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const source = measurementSource(fish, measurementMap[fish.id]);
      const needsV5 = entry.measurementVersion < 5;
      const lengthCm = needsV5 && (entry.lengthCm < source.min || entry.lengthCm > source.max)
        ? generateMeasurement(fish, random, measurementMap[fish.id]).lengthCm
        : Math.min(source.max, Math.max(source.min, entry.lengthCm));
      const restoredWeightKg = needsV5
        ? Math.min(source.maxWeight, Math.max(source.minWeight, preciseWeightKg(weightForLength(source, lengthCm, random))))
        : entry.weightKg;
      const weightKg = Math.max(1e-9, restoredWeightKg);
      const valueCoins = entry.valueCoins == null || needsV5
        ? calculateCatchValue(fish, { lengthCm, weightKg }, measurementMap[fish.id])
        : entry.valueCoins;
      const repaired = { ...entry, lengthCm, size: `${lengthCm.toFixed(1)} cm`, weightKg, weight: formatWeight(weightKg), measurementVersion: 5, valueCoins };
      const aggregate = repairedByFish[fish.id] || { maxLengthCm: 0, maxWeightKg: 0 };
      aggregate.maxLengthCm = Math.max(aggregate.maxLengthCm, lengthCm);
      aggregate.maxWeightKg = Math.max(aggregate.maxWeightKg, weightKg);
      repairedByFish[fish.id] = aggregate;
      return repaired;
    });
    const collection = Object.fromEntries(Object.entries(state.collection).map(([fishId, record]) => {
      const fish = FISH.find((item) => item.id === fishId);
      const source = fish ? measurementSource(fish, measurementMap[fishId]) : null;
      const aggregate = repairedByFish[fishId];
      return [fishId, {
        ...record,
        maxLengthCm: source ? Math.max(aggregate?.maxLengthCm || 0, Math.min(source.max, record.maxLengthCm)) : record.maxLengthCm,
        maxWeightKg: source ? Math.max(aggregate?.maxWeightKg || 0, Math.min(source.maxWeight, record.maxWeightKg)) : record.maxWeightKg
      }];
    }));
    const historyByCatch = new Map(history.map((entry) => [entry.catchId, entry]));
    const inventory = state.inventory.map((entry) => {
      const matching = historyByCatch.get(entry.catchId);
      if (matching) return normalizeInventoryEntry({ ...entry, ...matching, fishId: matching.resultId, caughtAt: matching.at }, 0, matching.at);
      const fish = FISH.find((item) => item.id === entry.fishId);
      if (!fish) return entry;
      let seed = [...String(entry.catchId)].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const source = measurementSource(fish, measurementMap[fish.id]);
      const needsV5 = entry.measurementVersion < 5;
      const lengthCm = needsV5 && (entry.lengthCm < source.min || entry.lengthCm > source.max)
        ? generateMeasurement(fish, random, measurementMap[fish.id]).lengthCm
        : Math.min(source.max, Math.max(source.min, entry.lengthCm));
      const weightKg = needsV5 ? preciseWeightKg(weightForLength(source, lengthCm, random)) : entry.weightKg;
      const valueCoins = (entry.valueCoins == null || needsV5)
        ? calculateCatchValue(fish, { lengthCm, weightKg }, measurementMap[fish.id])
        : entry.valueCoins;
      return { ...entry, lengthCm, size: `${lengthCm.toFixed(1)} cm`, weightKg, weight: formatWeight(weightKg), valueCoins, measurementVersion: 5 };
    });
    const currentResult = state.currentResult
      ? history.find((entry) => entry.catchId === state.currentResult.catchId) || state.currentResult
      : null;
    const largestWeightKg = Math.max(0, ...Object.values(collection).map((record) => finite(record.maxWeightKg)));
    const largestLengthCm = Math.max(0, ...Object.values(collection).map((record) => finite(record.maxLengthCm)));
    return achievementSystem.finalizeMeasurements({ ...state, history, inventory, collection, currentResult, measurementVersion: 5, economyVersion: ECONOMY_VERSION, stats: { ...state.stats, largestLengthCm, largestWeightKg } });
  }

  function commitCatch(input, random = Math.random, now = Date.now(), measurementMap = {}) {
    const state = normalizeState(input, now);
    if (state.fishingState !== 'catch_land' || state.catchCommitted) return state;
    if (state.pendingCatch?.encounterType === 'special') {
      const event = specialEvents.byId(state.pendingCatch.eventId);
      const specialCatchId = state.pendingCatch.catchId || `special-${state.pendingCatch.selectedAt || now}-${state.pendingCatch.eventId}-${state.castCount}`;
      if (state.achievementData.committedSpecialIds.includes(specialCatchId)) return { ...state, catchCommitted: true };
      if (!event) return { ...state, catchCommitted: true, currentResult: { type: 'special', probabilityVersion: state.pendingCatch.probabilityVersion, catchId: state.pendingCatch.catchId || `special-${now}-${state.pendingCatch.eventId}`, eventId: state.pendingCatch.eventId, baitId: state.pendingCatch.baitId, iconPath: null, animationPath: null, at: now } };
      const old = state.specialEventCollection.entries[event.id];
      const entry = { count: Math.min(Number.MAX_SAFE_INTEGER, (old?.count || 0) + 1), firstFoundAt: old?.firstFoundAt || now, lastFoundAt: now };
      const collection = { ...state.specialEventCollection, schemaVersion: 1, entries: { ...state.specialEventCollection.entries, [event.id]: entry } };
      const duplicate = old?.count > 0;
      state.achievementData = { ...state.achievementData, committedSpecialIds: [...state.achievementData.committedSpecialIds, specialCatchId].slice(-128) };
      return unlockAchievements({ ...state, catchCommitted: true, currentResult: { type: 'special', encounterType: 'special', probabilityVersion: state.pendingCatch.probabilityVersion, catchId: state.pendingCatch.catchId || `special-${now}-${event.id}`, seriesId: event.seriesId, seriesName: event.seriesName, eventId: event.id, title: event.title, description: event.description, iconPath: event.iconPath, animationPath: event.animationPath, baitId: state.pendingCatch.baitId, count: entry.count, firstFoundAt: entry.firstFoundAt, lastFoundAt: entry.lastFoundAt, first: !duplicate }, specialEventCollection: collection, specialEventPity: { ...state.specialEventPity, duplicateSpecialStreak: duplicate ? Math.min(probability.DUPLICATE_SPECIAL_STREAK_LIMIT, state.specialEventPity.duplicateSpecialStreak + 1) : 0 }, lastUpdated: now, lastMessage: `发现了：${event.title}` }, now);
    }
    const fish = FISH.find((item) => item.id === state.pendingCatch?.fishId) || pickResult(random, getAvailableFish(state));
    const rolls = [...(state.pendingCatch?.measurementRolls || [])];
    let measurementSeed = rolls.reduce((seed, roll, index) => (seed ^ Math.floor(unitRandom(() => roll) * 0xffffffff) ^ ((index + 1) * 0x9e3779b9)) >>> 0, 0x6d2b79f5);
    const seededRandom = () => {
      measurementSeed = (measurementSeed + 0x6d2b79f5) >>> 0;
      let value = measurementSeed;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const deterministicRandom = () => rolls.length ? unitRandom(() => rolls.shift()) : seededRandom();
    const measurement = generateMeasurement(fish, deterministicRandom, measurementMap[fish.id]);
    const old = state.collection[fish.id] || {};
    const catchId = state.pendingCatch?.catchId || `catch-${state.pendingCatch?.selectedAt || now}-${fish.id}-${state.castCount}`;
    const existing = state.history.find((entry) => entry.catchId === catchId);
    if (existing) return { ...state, catchCommitted: true, currentResult: existing };
    const variant = variants.normalizeVariant(state.pendingCatch?.variant);
    const isFirstRareVariant = (variant === 'golden' || variant === 'iridescent') && !(old.variants?.[variant]?.count);
    const valueCoins = Math.max(1, Math.round(calculateCatchValue(fish, measurement, measurementMap[fish.id]) * variants.VALUE_MULTIPLIERS[variant]));
    const entry = {
      catchId, id: catchId, at: now, resultId: fish.id, name: fish.name, type: 'fish',
      rarity: fish.rarity, rarityName: fish.rarityName, pack: fish.pack, packName: fish.packName,
      lengthCm: measurement.lengthCm, weightKg: measurement.weightKg,
      size: `${measurement.lengthCm.toFixed(1)} cm`, weight: formatWeight(measurement.weightKg),
      displayClass: measurement.displayClass, first: !old.count,
      variant, variantVersion: VARIANT_VERSION, baitId: state.pendingCatch?.baitId || null, probabilityVersion: state.pendingCatch?.probabilityVersion || PROBABILITY_VERSION,
      locked: isFirstRareVariant, autoLocked: isFirstRareVariant,
      recordLength: measurement.lengthCm > finite(old.maxLengthCm, old.maxSize),
      recordWeight: measurement.weightKg > finite(old.maxWeightKg, old.maxWeight), measurementVersion: 5,
      valueCoins, soldAt: null
    };
    const inventoryEntry = normalizeInventoryEntry({ ...entry, inventoryId: catchId, fishId: fish.id, caughtAt: now }, 0, now);
    const stats = JSON.parse(JSON.stringify(state.stats));
    stats.totalCatchCount += 1;
    stats.rarity[fish.rarity] += 1;
    stats.packs[fish.pack] += 1;
    if (!old.count) stats.packUnique[fish.pack] += 1;
    stats.largestLengthCm = Math.max(stats.largestLengthCm, measurement.lengthCm);
    stats.largestWeightKg = Math.max(stats.largestWeightKg, measurement.weightKg);
    stats.distinctStreak = stats.lastCaughtFishId && stats.lastCaughtFishId !== fish.id ? stats.distinctStreak + 1 : stats.lastCaughtFishId ? 1 : 1;
    stats.bestDistinctStreak = Math.max(stats.bestDistinctStreak, stats.distinctStreak);
    stats.lastCaughtFishId = fish.id;
    const collection = {
      ...state.collection,
      [fish.id]: {
        count: finite(old.count) + 1, firstAt: old.firstAt || now, lastAt: now,
        maxLengthCm: Math.max(finite(old.maxLengthCm, old.maxSize), measurement.lengthCm),
        maxWeightKg: Math.max(finite(old.maxWeightKg, old.maxWeight), measurement.weightKg),
        variants: variants.applyCatch(old.variants, variant, now, measurement)
      }
    };
    stats.uniqueSpeciesCount = Object.keys(collection).length;
    return unlockAchievements({
      ...state, catchCommitted: true, currentResult: entry,
      achievementData: achievementSystem.recordFish(state.achievementData, entry),
      catches: state.catches + 1, collection, history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
      inventory: [inventoryEntry, ...state.inventory], economyVersion: ECONOMY_VERSION, measurementVersion: 5,
      stats, pity: probability.updatePity(state.pity, variant), lastUpdated: now, lastMessage: `钓到了：${fish.name}`
    }, now);
  }

  function suspend(input, now = Date.now()) {
    const state = normalizeState(input, now);
    if (state.isPaused) return state;
    return {
      ...state, isPaused: true,
      pausedTimers: {
        stateRemainingMs: state.stateEndsAt == null ? null : Math.max(0, state.stateEndsAt - now),
        biteRemainingMs: state.biteDeadlineAt == null ? null : Math.max(0, state.biteDeadlineAt - now),
        catchCommitRemainingMs: state.catchCommitAt == null ? null : Math.max(0, state.catchCommitAt - now),
        castTimerElapsedMs: state.castTimerStartedAt == null ? state.castTimerElapsedMs : Math.max(state.castTimerElapsedMs, now - state.castTimerStartedAt)
      },
      stateEndsAt: null, biteDeadlineAt: null, catchCommitAt: null, castTimerStartedAt: null, lastUpdated: now
    };
  }

  function resume(input, now = Date.now()) {
    const state = normalizeState(input, now);
    if (!state.isPaused) return state;
    return {
      ...state, isPaused: false,
      stateEndsAt: state.pausedTimers?.stateRemainingMs == null ? null : now + state.pausedTimers.stateRemainingMs,
      biteDeadlineAt: state.pausedTimers?.biteRemainingMs == null ? null : now + state.pausedTimers.biteRemainingMs,
      catchCommitAt: state.pausedTimers?.catchCommitRemainingMs == null ? null : now + state.pausedTimers.catchCommitRemainingMs,
      castTimerElapsedMs: Math.max(0, finite(state.pausedTimers?.castTimerElapsedMs, state.castTimerElapsedMs)),
      castTimerStartedAt: ['casting', 'waiting'].includes(state.fishingState) ? now - Math.max(0, finite(state.pausedTimers?.castTimerElapsedMs, state.castTimerElapsedMs)) : null,
      pausedTimers: null, lastUpdated: now
    };
  }

  function applySettings(input, patch, now = Date.now()) {
    const state = normalizeState(input, now);
    const allowed = Object.keys(defaultSettings);
    const sanitized = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key)));
    const settings = { ...state.settings, ...sanitized };
    for (const key of ['muted', 'sounds', 'alwaysOnTop', 'launchAtLogin', 'showCastTimer', 'autoCastEnabled']) settings[key] = Boolean(settings[key]);
    if (!state.equipment.ownedIds.includes(AUTO_CAST_ROD_ID)) settings.autoCastEnabled = false;
    settings.petScale = Math.min(1.35, Math.max(0.75, finite(settings.petScale, 1)));
    for (const key of ['petShortcut', 'panelShortcut', 'fishingShortcut']) {
      if (typeof settings[key] !== 'string' || settings[key].length > 80) settings[key] = state.settings[key];
    }
    return { ...state, settings, autoCastPending: settings.autoCastEnabled ? state.autoCastPending : false, lastUpdated: now };
  }

  function aquariumAction(input, action, payload = {}, now = Date.now()) {
    const state = normalizeState(input, now);
    if (!aquariumState) return { ok: false, reason: 'aquarium-unavailable', state, snapshot: state };
    let operation;
    if (action === 'place-fish') operation = aquariumState.placeFish(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'remove-fish') operation = aquariumState.removeFish(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'switch-habitat') operation = aquariumState.switchHabitat(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'switch-tank') operation = aquariumState.switchTank(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'set-tank-habitat') operation = aquariumState.setTankHabitat(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'purchase-item') operation = aquariumState.purchaseItem(state.aquarium, state.wallet, state.inventory, state.ownedPacks, payload);
    else if (action === 'save-layout') operation = aquariumState.saveLayout(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'set-setting') operation = aquariumState.setSetting(state.aquarium, state.inventory, state.ownedPacks, payload);
    else if (action === 'show-window') operation = aquariumState.setVisibility(state.aquarium, state.inventory, state.ownedPacks, true);
    else if (action === 'hide-window') operation = aquariumState.setVisibility(state.aquarium, state.inventory, state.ownedPacks, false);
    else if (action === 'open-layout') operation = { ok: true, reason: null, snapshot: state.aquarium };
    else return { ok: false, reason: 'unknown-aquarium-action', state, snapshot: state };
    if (!operation.ok) return { ...operation, state, snapshot: state };
    const next = {
      ...state,
      aquarium: operation.snapshot,
      wallet: operation.wallet || state.wallet,
      lastUpdated: now
    };
    next.inventory = aquariumState.applyDisplayLocks(next.inventory, next.aquarium);
    const { snapshot: _aquariumSnapshot, wallet: _wallet, ...metadata } = operation;
    return { ...metadata, ok: true, reason: null, state: next, snapshot: next };
  }

  const applyAquariumAction = aquariumAction;

  function safeAssetPath(assetPath, extension = '.png') {
    if (typeof assetPath !== 'string') return null;
    const normalized = assetPath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes(':') || !normalized.toLowerCase().endsWith(extension)) return null;
    return normalized;
  }

  function safeFishIconPath(assetPath) {
    const safe = safeAssetPath(assetPath);
    return safe && (safe.startsWith('icons/') || safe.includes('/icons/')) ? safe : null;
  }

  function fishManifestMap(manifest) {
    const map = {};
    for (const entry of Array.isArray(manifest?.entries) ? manifest.entries : []) {
      const index = Number(entry.catalogIndex ?? entry.catalog_index);
      const assetPath = safeAssetPath(entry.icon || entry.path || entry.file);
      if (Number.isInteger(index) && assetPath) map[`fish-${index}`] = assetPath;
    }
    return map;
  }

  const api = {
    STATES, PACKS, PACK_ORDER, PACK_PRICES, PACK_PREREQUISITES, PACK_DEFINITIONS, PACK_HABITATS, HABITATS,
    AUTO_CAST_ROD_ID, BAIT_ORDER, EQUIPMENT_ORDER, EQUIPMENT_DEFINITIONS,
    RARITIES, RARITY_BASE_VALUES, PACK_MULTIPLIERS, rarityNames, FISH, ALL_RESULTS: FISH, ACHIEVEMENTS,
    SAVE_SCHEMA_VERSION, ECONOMY_VERSION, HISTORY_LIMIT, BITE_DURATION_MS, URGENT_DURATION_MS,
    ACTION_DURATIONS, defaultSettings, createInitialState, normalizeState, durationFor,
    transition, tick, suspend, resume, commitCatch, pickResult, getAvailableFish, canSwitchHabitat, switchHabitat, autoCastAvailable,
    generateMeasurement, repairLegacyMeasurements, getFishBaseValue, calculateCatchValue, getPackPrice,
    purchasePack, purchaseEquipment, equipBait, sortInventory, sellInventory, setInventoryLocked, pickEncounter,
    formatWeight, personalRecordSummary, unlockAchievements, achievementProgress, achievementSummary, achievementDetails, applyAchievementAction, ACHIEVEMENT_SERIES, applySettings,
    aquariumState, AQUARIUM_CATALOG: aquariumState?.DEFAULT_CATALOG || null, aquariumAction, applyAquariumAction,
    safeAssetPath, safeFishIconPath, fishManifestMap, PROBABILITY_VERSION, VARIANT_VERSION
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
