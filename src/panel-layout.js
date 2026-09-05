'use strict';

// Restore width and height independently, including when a monitor disappears.
function restoredBounds(saved, area, fallback = { width: 640, height: 560 }) {
  const finite = (value, defaultValue) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
  const width = Math.round(Math.min(area.width, Math.max(480, finite(saved.width, fallback.width))));
  const height = Math.round(Math.min(area.height, Math.max(420, finite(saved.height, fallback.height))));
  return {
    x: Math.round(Math.max(area.x, Math.min(finite(saved.x, area.x), area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(finite(saved.y, area.y), area.y + area.height - height))),
    width, height
  };
}

module.exports = { restoredBounds };
