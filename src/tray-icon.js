const path = require('node:path');

const TRAY_ICON_SIZES = Object.freeze([16, 20, 24, 32, 48, 64]);
// A copy of this project's 32px raster icon keeps optional tray artwork from
// preventing startup when package files are missing or damaged.
const FALLBACK_PNG = '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';

// nativeImage decodes PNG/BMP, not SVG data URLs. Supply actual raster
// representations so Windows can select the correct image at each DPI.
function createTrayIcon(nativeImage, root = path.resolve(__dirname, '..'), { warn = console.warn } = {}) {
  const image = nativeImage.createEmpty();
  const available = new Map();
  const missing = [];
  for (const size of TRAY_ICON_SIZES) {
    try {
      const source = nativeImage.createFromPath(path.join(root, 'assets', 'ui', 'tray', `screen-fishing-${size}.png`));
      if (source.isEmpty()) missing.push(size);
      else available.set(size, source);
    } catch { missing.push(size); }
  }
  const embeddedFallback = available.size === 0;
  if (embeddedFallback) available.set(32, nativeImage.createFromBuffer(Buffer.from(FALLBACK_PNG, 'base64')));
  for (const size of TRAY_ICON_SIZES) {
    const sourceSize = available.has(size) ? size : [...available.keys()].sort((a, b) => Math.abs(a - size) - Math.abs(b - size) || b - a)[0];
    const source = available.get(sourceSize);
    const bitmap = source.getSize().width === size && source.getSize().height === size
      ? source : source.resize({ width: size, height: size, quality: 'best' });
    image.addRepresentation({ scaleFactor: size / 16, buffer: bitmap.toPNG() });
  }
  if (missing.length) warn(`[tray-icon] Missing or damaged PNG sizes: ${missing.join(', ')}; ${embeddedFallback ? 'using embedded PNG fallback' : 'rebuilding from valid packaged PNGs'}.`);
  return image;
}

module.exports = { TRAY_ICON_SIZES, createTrayIcon };
