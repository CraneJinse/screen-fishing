'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const StorageLocation = require('../src/storage-location');

test('production storage is bound to the executable directory', () => {
  assert.equal(
    StorageLocation.productionUserDataDirectory('F:\\Games\\ScreenFishing-A\\ScreenFishing.exe'),
    path.resolve('F:\\Games\\ScreenFishing-A', 'user-data')
  );
});

test('development storage stays inside the project and separate from portable copies', () => {
  assert.equal(
    StorageLocation.developmentUserDataDirectory('F:\\ChatGPT\\摸鱼小游戏'),
    path.resolve('F:\\ChatGPT\\摸鱼小游戏', '.screen-fishing-dev')
  );
});
