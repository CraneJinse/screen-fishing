const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, nativeImage, Tray } = require('electron');
const { createTrayIcon, TRAY_ICON_SIZES } = require('../src/tray-icon');

function inspectRepresentations(icon) {
  return TRAY_ICON_SIZES.map(size => {
    const bitmap = icon.toBitmap({ scaleFactor: size / 16 });
    let visiblePixels = 0;
    for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i]) visiblePixels++;
    return { pixels: size, scaleFactor: size / 16, dimensions: icon.getSize(size / 16), visiblePixels,
      valid: bitmap.length === size * size * 4 && visiblePixels > size * size * .2 && visiblePixels < size * size * .85 };
  });
}

async function verifyMissingAssets(root) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-tray-faults-'));
  const scenarios = [];
  try {
    for (const scenario of ['missing-one', 'missing-all', 'damaged-one']) {
      const sourceRoot = path.join(temporaryRoot, scenario);
      const destination = path.join(sourceRoot, 'assets', 'ui', 'tray');
      fs.mkdirSync(destination, { recursive: true });
      if (scenario !== 'missing-all') for (const size of TRAY_ICON_SIZES) {
        const name = `screen-fishing-${size}.png`;
        if (size !== 24) fs.copyFileSync(path.join(root, 'assets', 'ui', 'tray', name), path.join(destination, name));
        else if (scenario === 'damaged-one') fs.writeFileSync(path.join(destination, name), 'invalid png');
      }
      const warnings = [];
      const image = createTrayIcon(nativeImage, sourceRoot, { warn: warning => warnings.push(warning) });
      const representations = inspectRepresentations(image);
      const tray = new Tray(image);
      await new Promise(resolve => setTimeout(resolve, 150));
      const bounds = tray.getBounds();
      scenarios.push({ scenario, warnings, imageEmpty: image.isEmpty(), representations,
        trayBounds: bounds, ok: !image.isEmpty() && !tray.isDestroyed() && bounds.width > 0 && bounds.height > 0
          && representations.every(entry => entry.valid) && warnings.length === 1 });
      tray.destroy();
    }
  } finally {
    const resolved = path.resolve(temporaryRoot);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('screen-fishing-tray-faults-')) throw new Error('Unsafe tray test cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  return scenarios;
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'screen-fishing-tray-')));
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const oldSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#6cb8b7"/></svg>';
  const oldImage = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(oldSvg).toString('base64')}`);
  const icon = createTrayIcon(nativeImage, root);
  const representations = inspectRepresentations(icon);
  const tray = new Tray(icon);
  tray.setToolTip('屏幕钓鱼 · 图标验证');
  await new Promise(resolve => setTimeout(resolve, 300));
  const bounds = tray.getBounds();
  const missingAssetScenarios = await verifyMissingAssets(root);
  const report = { generatedAt: new Date().toISOString(), electron: process.versions.electron,
    oldSvgDecodedEmpty: oldImage.isEmpty(), iconEmpty: icon.isEmpty(), scaleFactors: icon.getScaleFactors(),
    representations, trayCreated: !tray.isDestroyed(), trayBounds: bounds, missingAssetScenarios,
    ok: !icon.isEmpty() && representations.every(item => item.valid) && !tray.isDestroyed() && bounds.width > 0 && bounds.height > 0 && missingAssetScenarios.every(item => item.ok) };
  const output = path.join(root, 'artifacts', 'tray-icon-verification.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  tray.destroy();
  process.stdout.write(`POND_TRAY_ICON:${JSON.stringify(report)}\n`);
  app.exit(report.ok ? 0 : 1);
}).catch(error => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
