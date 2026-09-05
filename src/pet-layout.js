(function exposePetLayout(globalScope) {
  'use strict';

  function pointInEllipse(x, y, cx, cy, rx, ry) {
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }
  function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]; const [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function isPetInteractivePoint(stageX, stageY, scale = 1, bodyLeft = 0, stageHeight = 220) {
    const x = (stageX - bodyLeft) / scale;
    const y = (stageY - (stageHeight - 208 * scale)) / scale;
    if (x < 0 || y < 0 || x > 192 || y > 208) return false;
    const head = pointInEllipse(x, y, 89, 69, 31, 35);
    const body = pointInPolygon(x, y, [[53, 84], [117, 80], [132, 151], [48, 160]]);
    // The transparent window is intentionally forgiving around the complete
    // silhouette. The old boat polygon started at x=14 and dropped the left
    // hull/person edge due to rounding at 75%-135% scale.
    const boat = pointInPolygon(x, y, [[4, 134], [184, 134], [178, 187], [164, 202], [25, 205], [5, 185]])
      || (x >= 8 && x <= 178 && y >= 58 && y <= 204);
    return head || body || boat;
  }
  function chooseToolSide(bodyX, bodyWidth, reserve, area, previous = 'right') {
    const leftSpace = bodyX - area.x;
    const rightSpace = area.x + area.width - (bodyX + bodyWidth);
    if (rightSpace < reserve && leftSpace >= reserve) return 'left';
    if (leftSpace < reserve && rightSpace >= reserve) return 'right';
    return previous === 'left' ? 'left' : 'right';
  }
  function layoutForBodyMove(desiredBodyX, bodyWidth, reserve, area, previous = 'right') {
    const bodyX = Math.max(area.x, Math.min(desiredBodyX, area.x + area.width - bodyWidth));
    const side = chooseToolSide(bodyX, bodyWidth, reserve, area, previous);
    const desiredWindowX = bodyX - (side === 'left' ? reserve : 0);
    const windowX = Math.max(area.x, Math.min(desiredWindowX, area.x + area.width - bodyWidth - reserve));
    return { side, windowX, bodyX: windowX + (side === 'left' ? reserve : 0) };
  }
  function cornerCaptureMargins(area) {
    return {
      x: Math.min(area.width * 0.25, Math.max(160, Math.min(320, area.width * 0.16))),
      y: Math.min(area.height * 0.25, Math.max(140, Math.min(240, area.height * 0.18)))
    };
  }
  function cornerIdForBounds(bounds, area, tolerance) {
    if (!bounds || !area || ![bounds.x, bounds.y, bounds.width, bounds.height, area.x, area.y, area.width, area.height].every(Number.isFinite)
      || Math.min(bounds.width, bounds.height, area.width, area.height) <= 0) return null;
    const margin = tolerance == null ? cornerCaptureMargins(area)
      : { x: Math.max(0, Number(tolerance) || 0), y: Math.max(0, Number(tolerance) || 0) };
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    if (centerX < area.x || centerX > area.x + area.width || centerY < area.y || centerY > area.y + area.height) return null;
    // Select one quadrant even on a small work area or with a large pet.
    const left = centerX < area.x + area.width / 2;
    const top = centerY < area.y + area.height / 2;
    const distanceX = Math.abs(left ? bounds.x - area.x : bounds.x + bounds.width - area.x - area.width);
    const distanceY = Math.abs(top ? bounds.y - area.y : bounds.y + bounds.height - area.y - area.height);
    return distanceX <= margin.x && distanceY <= margin.y
      ? `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}` : null;
  }
  function actionElapsed(now, stateStartedAt, visualOverride) {
    const startedAt = visualOverride && Number.isFinite(Number(visualOverride.startedAt))
      ? Number(visualOverride.startedAt)
      : Number(stateStartedAt) || now;
    return Math.max(0, now - startedAt);
  }
  const api = { isPetInteractivePoint, chooseToolSide, layoutForBodyMove, cornerCaptureMargins, cornerIdForBounds, actionElapsed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondPetLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
