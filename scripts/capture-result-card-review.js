'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { PNG } = require('pngjs');
const Game = require('../src/game-state-runtime');
const AssetRuntime = require('../src/asset-runtime');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'artifacts', 'result-card-review-synced-layout');
const cardSize = { width: 168, height: 176 };
const runtimeCardSizes = [
  { name: 'review-100', width: 168, height: 176 },
  { name: 'live-135', width: 200, height: 210 }
];
const raritySamples = [
  { rarity: 'common', fishId: 'fish-1', size: '12.8 cm', weight: '32 g' },
  { rarity: 'rare', fishId: 'fish-18', size: '14.5 cm', weight: '58 g' },
  { rarity: 'epic', fishId: 'fish-20', size: '18.7 cm', weight: '142 g' },
  { rarity: 'legendary', fishId: 'fish-24', size: '62.4 cm', weight: '4.81 kg' },
  { rarity: 'mythic', fishId: 'fish-26', size: '41.8 cm', weight: '2.36 kg' }
];
const variants = ['normal', 'alternate', 'golden', 'iridescent'];
const variantNames = { normal: '原色', alternate: '异色', golden: '纯金', iridescent: '炫彩' };

app.setPath('userData', path.join(os.tmpdir(), `screen-fishing-result-review-${process.pid}`));

let reviewWindow;
let currentSnapshot;

function snapshotFor(sample, variant, assets, flags = {}) {
  const fish = Game.FISH.find((entry) => entry.id === sample.fishId);
  if (!fish || fish.rarity !== sample.rarity) throw new Error(`Invalid review fish: ${sample.fishId}`);
  const state = Game.createInitialState(Date.now());
  state.currentResult = {
    catchId: `review-${sample.rarity}-${variant}`,
    resultId: fish.id,
    name: fish.name,
    rarity: fish.rarity,
    rarityName: fish.rarityName,
    pack: fish.pack,
    packName: fish.packName,
    size: sample.size,
    weight: sample.weight,
    first: Boolean(flags.first),
    recordLength: Boolean(flags.recordLength),
    recordWeight: Boolean(flags.recordWeight),
    variant,
    variantVersion: 1,
    probabilityVersion: 1,
    locked: ['golden', 'iridescent'].includes(variant),
    autoLocked: ['golden', 'iridescent'].includes(variant)
  };
  return {
    state,
    catalog: Game.FISH,
    packs: Game.PACKS,
    rarities: Game.RARITIES,
    rarityNames: Game.rarityNames,
    achievements: Game.ACHIEVEMENTS,
    assets,
    app: { persistenceError: null, shortcuts: {} }
  };
}

function achievementSnapshot(assets) {
  const definition = Game.ACHIEVEMENTS.find((item) => item.id === 'all-rarities') || Game.ACHIEVEMENTS[0];
  return {
    state: Game.createInitialState(Date.now()),
    resultCard: {
      type: 'achievement', achievementId: definition.id, title: definition.name,
      description: definition.description, seriesName: definition.seriesName,
      iconPath: definition.iconPath, points: definition.points
    },
    catalog: Game.FISH, packs: Game.PACKS, rarities: Game.RARITIES,
    rarityNames: Game.rarityNames, achievements: Game.ACHIEVEMENTS, assets,
    app: { persistenceError: null, shortcuts: {} }
  };
}

async function capturePng(file) {
  let error;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await reviewWindow.capturePage();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const image = await reviewWindow.capturePage();
      fs.writeFileSync(file, image.toPNG());
      return;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw error || new Error(`Unable to capture ${file}`);
}

function buildContactSheet(files) {
  const firstImage = PNG.sync.read(fs.readFileSync(files[0].file));
  const captureSize = { width: firstImage.width, height: firstImage.height };
  const gap = Math.max(12, Math.round(captureSize.width * .05));
  const margin = Math.max(18, Math.round(captureSize.width * .07));
  const width = margin * 2 + variants.length * captureSize.width + (variants.length - 1) * gap;
  const height = margin * 2 + raritySamples.length * captureSize.height + (raritySamples.length - 1) * gap;
  const sheet = new PNG({ width, height });
  for (let index = 0; index < sheet.data.length; index += 4) {
    sheet.data[index] = 21;
    sheet.data[index + 1] = 26;
    sheet.data[index + 2] = 39;
    sheet.data[index + 3] = 255;
  }
  files.forEach(({ file, row, column }) => {
    const image = PNG.sync.read(fs.readFileSync(file));
    PNG.bitblt(image, sheet, 0, 0, image.width, image.height,
      margin + column * (captureSize.width + gap), margin + row * (captureSize.height + gap));
  });
  const output = path.join(outputDir, 'result-card-matrix-5x4.png');
  fs.writeFileSync(output, PNG.sync.write(sheet));
  return output;
}

function buildHorizontalSheet(files, filename) {
  const captures = files.map((item) => ({ ...item, image: PNG.sync.read(fs.readFileSync(item.file)) }));
  const gap = 18;
  const margin = 20;
  const contentHeight = Math.max(...captures.map(({ image }) => image.height));
  const width = margin * 2 + captures.reduce((sum, { image }) => sum + image.width, 0) + gap * (captures.length - 1);
  const sheet = new PNG({ width, height: margin * 2 + contentHeight });
  for (let index = 0; index < sheet.data.length; index += 4) {
    sheet.data[index] = 21;
    sheet.data[index + 1] = 26;
    sheet.data[index + 2] = 39;
    sheet.data[index + 3] = 255;
  }
  let x = margin;
  captures.forEach(({ image }) => {
    PNG.bitblt(image, sheet, 0, 0, image.width, image.height, x, margin + Math.floor((contentHeight - image.height) / 2));
    x += image.width + gap;
  });
  const output = path.join(outputDir, filename);
  fs.writeFileSync(output, PNG.sync.write(sheet));
  return output;
}

async function run() {
  // Review images are commonly open in Codex or an image viewer on Windows.
  // Reuse the stable directory instead of deleting it, which otherwise leaves
  // the path pending deletion and makes the next mkdir fail with EPERM.
  fs.mkdirSync(outputDir, { recursive: true });
  const assets = AssetRuntime.buildAssetSnapshot(projectRoot, Game.FISH);
  reviewWindow = new BrowserWindow({
    ...cardSize,
    frame: false,
    show: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      preload: path.join(projectRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  ipcMain.handle('game:get', () => currentSnapshot);
  ipcMain.handle('window:close-result', () => true);
  ipcMain.handle('window:open-panel', () => true);
  await reviewWindow.loadFile(path.join(projectRoot, 'src', 'result.html'));
  reviewWindow.showInactive();

  const files = [];
  for (let row = 0; row < raritySamples.length; row += 1) {
    for (let column = 0; column < variants.length; column += 1) {
      const sample = raritySamples[row];
      const variant = variants[column];
      currentSnapshot = snapshotFor(sample, variant, assets);
      reviewWindow.webContents.send('game:update', currentSnapshot);
      await reviewWindow.webContents.executeJavaScript(`Promise.all([...document.images].map((image) => image.decode?.().catch(() => {})))`, true);
      await new Promise((resolve) => setTimeout(resolve, 380));
      const filename = `${String(row + 1).padStart(2, '0')}-${sample.rarity}-${variant}.png`;
      const file = path.join(outputDir, filename);
      await capturePng(file);
      files.push({ file, row, column });
    }
  }

  const matrix = buildContactSheet(files);
  const runtimeParityFiles = [];
  const runtimeSample = raritySamples[0];
  for (const size of runtimeCardSizes) {
    reviewWindow.setSize(size.width, size.height);
    currentSnapshot = snapshotFor(runtimeSample, 'iridescent', assets, { first: true, recordLength: true });
    reviewWindow.webContents.send('game:update', currentSnapshot);
    await reviewWindow.webContents.executeJavaScript(`Promise.all([...document.images].map((image) => image.decode?.().catch(() => {})))`, true);
    await new Promise((resolve) => setTimeout(resolve, 380));
    const file = path.join(outputDir, `runtime-parity-${size.name}.png`);
    await capturePng(file);
    runtimeParityFiles.push({ file, ...size });
  }
  const runtimeParityMatrix = buildHorizontalSheet(runtimeParityFiles, 'runtime-parity-100-vs-135.png');
  reviewWindow.setSize(cardSize.width, cardSize.height);
  currentSnapshot = achievementSnapshot(assets);
  reviewWindow.webContents.send('game:update', currentSnapshot);
  await reviewWindow.webContents.executeJavaScript(`Promise.all([...document.images].map((image) => image.decode?.().catch(() => {})))`, true);
  await new Promise((resolve) => setTimeout(resolve, 380));
  const achievementLayout = await reviewWindow.webContents.executeJavaScript(`(() => {
    const card = document.getElementById('catchCard').getBoundingClientRect();
    const nodes = ['rarity', 'fishImage', 'fishName', 'measure'].map((id) => document.getElementById(id).getBoundingClientRect());
    nodes.push(document.querySelector('.catch-card small').getBoundingClientRect());
    return { valid: nodes.every((rect) => rect.left >= card.left && rect.right <= card.right && rect.top >= card.top && rect.bottom <= card.bottom), card: { width: card.width, height: card.height }, nodes: nodes.map((rect) => ({ top: rect.top, bottom: rect.bottom })) };
  })()`, true);
  if (!achievementLayout.valid) throw new Error(`Achievement popup content overflowed: ${JSON.stringify(achievementLayout)}`);
  const achievementFile = path.join(outputDir, 'achievement-unlock.png');
  await capturePng(achievementFile);
  const index = {
    generatedAt: new Date().toISOString(),
    applicationVersion: require('../package.json').version,
    component: 'src/result.html + src/result.js + src/result.css + src/result-runtime.css',
    rows: raritySamples.map((sample) => ({ rarity: sample.rarity, fishId: sample.fishId })),
    columns: variants.map((variant) => ({ variant, name: variantNames[variant] })),
    files: files.map(({ file, row, column }) => ({ file: path.basename(file), row, column })),
    matrix: path.basename(matrix),
    runtimeParity: {
      state: { variant: 'iridescent', first: true, recordLength: true },
      files: runtimeParityFiles.map(({ file, name, width, height }) => ({ file: path.basename(file), name, width, height })),
      matrix: path.basename(runtimeParityMatrix)
    },
    achievement: { file: path.basename(achievementFile), id: currentSnapshot.resultCard.achievementId, layout: achievementLayout }
  };
  fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`RESULT_CARD_REVIEW:${JSON.stringify({ outputDir, matrix, cards: files.length })}\n`);
  app.quit();
}

app.whenReady().then(run).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
