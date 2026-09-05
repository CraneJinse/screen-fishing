'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FishingCore = require('../src/fishing-core');

test('fishing core archives aquarium membership and releases every displayed fish', () => {
  const input = {
    inventory: [
      { inventoryId: 'fish-a', locked: true, displayLock: true },
      { inventoryId: 'fish-b', locked: false, displayLock: true },
      { inventoryId: 'fish-c', locked: true, displayLock: false }
    ],
    aquarium: {
      visible: true,
      settings: { visible: true, scale: 1.1 },
      ownedItemIds: ['tank-basic', 'plant-grass'],
      tankInstances: [{ tankId: 'tank-1', decor: [{ itemId: 'plant-grass' }], fish: [{ inventoryId: 'fish-a' }] }],
      tanks: { freshwater: { fish: [{ inventoryId: 'fish-a' }, { inventoryId: 'fish-b' }] } }
    }
  };
  const archive = FishingCore.archivePayload(input, '1.5.5');
  const output = FishingCore.disableAquariumState(input);

  assert.deepEqual(archive.displayedInventoryIds.sort(), ['fish-a', 'fish-b']);
  assert.equal(archive.aquarium.visible, true);
  assert.equal(output.aquarium.visible, false);
  assert.equal(output.aquarium.settings.visible, false);
  assert.deepEqual(output.aquarium.tankInstances[0].fish, []);
  assert.deepEqual(output.aquarium.tanks.freshwater.fish, []);
  assert.deepEqual(output.aquarium.tankInstances[0].decor, [{ itemId: 'plant-grass' }]);
  assert.deepEqual(output.aquarium.ownedItemIds, ['tank-basic', 'plant-grass']);
  assert.equal(output.inventory.every((entry) => entry.displayLock === false), true);
  assert.equal(output.inventory[0].locked, true);
  assert.equal(output.inventory[2].locked, true);
  assert.equal(input.aquarium.tankInstances[0].fish.length, 1);
});

