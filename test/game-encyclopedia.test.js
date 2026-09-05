'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const game = require('../src/game-state-runtime');

const root = path.join(__dirname, '..');
const encyclopediaPath = path.join(root, 'docs', 'encyclopedia', 'GAME_ENCYCLOPEDIA.md');

test('game encyclopedia covers every fish and the implemented 1.8 special-event boundary', () => {
  const content = fs.readFileSync(encyclopediaPath, 'utf8');
  for (const fish of game.FISH) assert.ok(content.includes(`| ${fish.id} |`), `missing ${fish.id}`);
  assert.match(content, /概率系统与特殊事件/);
  assert.match(content, /60 项特殊事件收藏/);
  assert.match(content, /34 张 256×256 事件物件图、34 套 1536×256 六帧上钩动画/);
  assert.match(content, /首次获得的纯金或炫彩鱼默认自动锁定/);
  assert.match(content, /V2\.2 珍珠基底与方案 B 正式结构层/);
  assert.match(content, /内部关键花纹逐像素保留原鱼 RGB/);
  assert.match(content, /图鉴长体型适配/);
  assert.match(content, /龙鱼按用户点名固定为 0\.84/);
  assert.match(content, /22 组、152 个时序帧/);
  assert.match(content, /F2\/S1\/S2 售价为 4000\/6000\/8000/);
});
