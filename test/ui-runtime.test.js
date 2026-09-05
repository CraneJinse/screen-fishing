const test = require('node:test');
const assert = require('node:assert/strict');
const Shortcuts = require('../src/shortcut-settings');
const Navigation = require('../src/ui-navigation');
const Measurements = require('../src/measurement-display');
const Sounds = require('../src/sound-cues');
const PetLayout = require('../src/pet-layout');

test('快捷键输入被规范化且拒绝重复或无效组合', () => {
  assert.equal(Shortcuts.normalizeAccelerator(' ctrl + shift + m '), 'CommandOrControl+Shift+M');
  assert.equal(Shortcuts.normalizeAccelerator('Alt+F12'), 'Alt+F12');
  assert.equal(Shortcuts.normalizeAccelerator('M'), null);
  assert.equal(Shortcuts.validateShortcutChange('pet', 'Ctrl+Shift+F', { pet: 'CommandOrControl+Shift+M', panel: 'CommandOrControl+Shift+F' }).ok, false);
});

test('四列图鉴方向键保持在有效索引内', () => {
  assert.equal(Navigation.nextGridIndex(5, 'ArrowRight', 10), 6);
  assert.equal(Navigation.nextGridIndex(5, 'ArrowDown', 10), 9);
  assert.equal(Navigation.nextGridIndex(1, 'ArrowUp', 10), 0);
  assert.equal(Navigation.nextGridIndex(9, 'ArrowRight', 10), 9);
});

test('现实资料兼容数组和对象格式并生成中文范围', () => {
  const map = Measurements.profileMap({ entries: [{ fishId: 'fish-1', descriptionZh: '生活在浅水区。', lengthCm: { min: 10, typical: 20, max: 30 } }] });
  assert.equal(Measurements.description(map['fish-1']), '生活在浅水区。');
  assert.equal(Measurements.rangeText(map['fish-1'].lengthCm, 'cm'), '10–30 cm，常见 20 cm');
});

test('声音事件只在状态边沿触发且稀有庆祝追加提示', () => {
  assert.deepEqual(Sounds.cuesForTransition('idle', 'casting'), ['cast']);
  assert.deepEqual(Sounds.cuesForTransition('bite_loop', 'catch_flight'), ['breach']);
  assert.deepEqual(Sounds.cuesForTransition('catch_land', 'celebrating', { rarity: 'legendary' }), ['rare']);
  assert.deepEqual(Sounds.cuesForTransition('celebrating', 'celebrating', { rarity: 'legendary' }), []);
});

test('桌宠点击区域包含人物和船但排除透明区与远端鱼竿', () => {
  assert.equal(PetLayout.isPetInteractivePoint(89, 81, 1, 0, 220), true);
  assert.equal(PetLayout.isPetInteractivePoint(90, 187, 1, 0, 220), true);
  assert.equal(PetLayout.isPetInteractivePoint(8, 170, 1, 0, 248), true);
  assert.equal(PetLayout.isPetInteractivePoint(31, 270, 1.35, 20, 321), true);
  assert.equal(PetLayout.isPetInteractivePoint(175, 42, 1, 0, 220), false);
  assert.equal(PetLayout.isPetInteractivePoint(5, 10, 1, 0, 220), false);
});

test('按钮预留在屏幕右缘翻到左侧且主体坐标不参与跳动', () => {
  const area = { x: 0, width: 1920 };
  assert.equal(PetLayout.chooseToolSide(1700, 192, 68, area, 'right'), 'left');
  assert.equal(PetLayout.chooseToolSide(20, 192, 68, area, 'left'), 'right');
  assert.equal(PetLayout.chooseToolSide(800, 192, 68, area, 'right'), 'right');
});

test('按钮翻转后连续拖动仍按主体锚点逐像素跟手', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const bodyWidth = 192;
  const reserve = 68;
  const rightEdge = area.width - bodyWidth;
  const atRight = PetLayout.layoutForBodyMove(rightEdge, bodyWidth, reserve, area, 'right');
  assert.equal(atRight.side, 'left');
  assert.equal(atRight.bodyX, rightEdge);
  const onePixelBack = PetLayout.layoutForBodyMove(rightEdge - 1, bodyWidth, reserve, area, atRight.side);
  assert.equal(onePixelBack.bodyX, rightEdge - 1);
  const atLeft = PetLayout.layoutForBodyMove(0, bodyWidth, reserve, area, onePixelBack.side);
  assert.equal(atLeft.side, 'right');
  assert.equal(atLeft.bodyX, 0);
  const onePixelForward = PetLayout.layoutForBodyMove(1, bodyWidth, reserve, area, atLeft.side);
  assert.equal(onePixelForward.bodyX, 1);
});

test('四角判定覆盖桌宠顶部安全边距且不误判远离角落的位置', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 };
  const body = { width: 192, height: 208 };
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -1920, y: 40 }, area), 'top-left');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -192, y: 40 }, area), 'top-right');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -1920, y: 832 }, area), 'bottom-left');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -192, y: 832 }, area), 'bottom-right');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -1855, y: 40 }, area), 'top-left');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -1920, y: 65 }, area), 'top-left');
  assert.equal(PetLayout.cornerIdForBounds({ ...body, x: -1000, y: 400 }, area), null);
});

test('临时交互动作使用独立起点且不改写游戏状态计时', () => {
  const stateStartedAt = 1000;
  const override = { actionId: 'menu_greet', startedAt: 9000 };
  assert.equal(PetLayout.actionElapsed(9000, stateStartedAt, override), 0);
  assert.equal(PetLayout.actionElapsed(9120, stateStartedAt, override), 120);
  assert.equal(PetLayout.actionElapsed(9120, stateStartedAt, null), 8120);
  assert.equal(stateStartedAt, 1000);
});
