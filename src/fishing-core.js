'use strict';

function cloneTankWithoutFish(tank) {
  if (!tank || typeof tank !== 'object') return tank;
  return { ...tank, fish: [] };
}

function displayedInventoryIds(state) {
  const ids = new Set();
  const aquarium = state?.aquarium;
  const collect = (tank) => {
    for (const entry of Array.isArray(tank?.fish) ? tank.fish : []) {
      const id = typeof entry === 'string' ? entry : entry?.inventoryId;
      if (id) ids.add(id);
    }
  };
  for (const tank of Array.isArray(aquarium?.tankInstances) ? aquarium.tankInstances : []) collect(tank);
  for (const tank of Object.values(aquarium?.tanks || {})) collect(tank);
  for (const entry of Array.isArray(state?.inventory) ? state.inventory : []) {
    if (entry?.displayLock && entry.inventoryId) ids.add(entry.inventoryId);
  }
  return [...ids];
}

function archivePayload(state, sourceVersion = '') {
  if (!state?.aquarium || typeof state.aquarium !== 'object') return null;
  return {
    schemaVersion: 1,
    sourceVersion: String(sourceVersion || ''),
    archivedAt: new Date().toISOString(),
    reason: 'aquarium-feature-shelved-for-fishing-core',
    aquarium: state.aquarium,
    displayedInventoryIds: displayedInventoryIds(state)
  };
}

function disableAquariumState(state) {
  if (!state || typeof state !== 'object') return state;
  const aquarium = state.aquarium && typeof state.aquarium === 'object'
    ? {
      ...state.aquarium,
      visible: false,
      settings: { ...(state.aquarium.settings || {}), visible: false },
      tankInstances: Array.isArray(state.aquarium.tankInstances)
        ? state.aquarium.tankInstances.map(cloneTankWithoutFish)
        : state.aquarium.tankInstances,
      tanks: state.aquarium.tanks && typeof state.aquarium.tanks === 'object'
        ? Object.fromEntries(Object.entries(state.aquarium.tanks).map(([key, tank]) => [key, cloneTankWithoutFish(tank)]))
        : state.aquarium.tanks
    }
    : state.aquarium;
  const inventory = Array.isArray(state.inventory)
    ? state.inventory.map((entry) => entry?.displayLock ? { ...entry, displayLock: false } : entry)
    : state.inventory;
  return { ...state, aquarium, inventory };
}

module.exports = { archivePayload, disableAquariumState, displayedInventoryIds };

