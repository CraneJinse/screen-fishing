(function petRenderer() {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bitingStates = new Set(['bite_intro', 'bite_loop', 'bite_urgent', 'bite_ready']);
  let snapshot;
  let corner = null;
  let drag = null;
  let quickTimer;
  let feedbackTimer;
  let animationTimer;
  let currentAction = '';
  let clickThrough = false;
  let previousFishingState = null;
  let audioContext;
  let visualOverride = null;
  let visualOverrideTimer;
  let yawnTimer;
  let blinkTimer;
  let castTimerInterval;
  let requestedAction = '';
  const actionImages = new Map();
  const decodedActionImages = new Set();
  let actionBundleKey = '';
  let petToolSide = 'right';
  let petBodyLeft = 0;
  let petBodyTop = 0;
  let petToolLeft = 216;
  const rootAsset = (relative) => relative.startsWith('file:') ? relative : `../${relative.replace(/\\/g, '/')}`;
  const manifest = (id) => snapshot?.assets?.manifests?.find((item) => item.id === id);
  function actionForState(state) {
    if (visualOverride) return visualOverride.actionId;
    if (state.fishingState === 'celebrating') return `celebrate_${state.currentResult?.rarity || 'common'}`;
    return ({ casting: 'cast', escaping: 'fish_escape', bite_ready: 'waiting', bite_urgent: 'bite_loop' })[state.fishingState] || state.fishingState;
  }
  function actionDurationMs(actionId) {
    const action = manifest('pet')?.data?.actions?.[actionId];
    if (!action) return 700;
    if (Array.isArray(action.frameDurationsMs)) return action.frameDurationsMs.reduce((sum, value) => sum + Number(value || 0), 0);
    return Math.max(1, Number(action.frameCount) || 1) * Math.max(16, Number(action.frameDurationMs) || 120);
  }
  function clearVisualOverride() {
    clearTimeout(visualOverrideTimer);
    if (!visualOverride) return;
    visualOverride = null;
    renderSprite();
  }
  function setVisualOverride(actionId, hold = true) {
    if (!manifest('pet')?.data?.actions?.[actionId]) return;
    clearTimeout(visualOverrideTimer);
    visualOverride = { actionId, startedAt: Date.now() };
    renderSprite();
    if (hold) visualOverrideTimer = setTimeout(clearVisualOverride, actionDurationMs(actionId));
  }
  function scheduleYawn() {
    clearTimeout(yawnTimer);
    yawnTimer = setTimeout(() => {
      if (snapshot?.state?.fishingState === 'idle' && !visualOverride && !drag && $('quickTools').hidden) setVisualOverride('idle_yawn');
      scheduleYawn();
    }, 25000 + Math.floor(Math.random() * 25001));
  }
  function fishAsset(fishId, variant = 'normal') {
    const bundles = (snapshot?.assets?.manifests || []).filter((item) => item.id === 'fish' || item.id.startsWith('fish-'));
    const selected = ['normal', 'alternate', 'golden', 'iridescent'].includes(variant) ? variant : 'normal';
    const baseBundle = bundles.find((item) => item.id === 'fish');
    const baseEntry = baseBundle?.data.entries?.find((item) => (item.fishId || item.id || `fish-${item.catalogIndex}`) === fishId);
    if (!baseEntry) return {};
    const variantBundle = selected === 'normal' ? null : bundles.find((item) => item.id === 'fish-variants');
    const variantEntry = variantBundle?.data.entries?.find((item) => item.fishId === fishId);
    const variantData = variantEntry?.variants?.[selected];
    const basePath = variantBundle?.basePath || baseBundle.basePath;
    const icon = variantData?.icon || baseEntry.icon || baseEntry.path;
    const airborne = variantData?.airborneStrip || baseEntry.airborneStrip;
    const layeredAirborne = selected === 'iridescent' && variantData?.baseAirborneStrip && variantData?.airborneMask && variantData?.detailOverlayStrip ? { base: rootAsset(`${basePath}/${variantData.baseAirborneStrip}`), mask: rootAsset(`${basePath}/${variantData.airborneMask}`), detail: rootAsset(`${basePath}/${variantData.detailOverlayStrip}`) } : null;
    return { icon: icon ? rootAsset(`${variantData ? basePath : baseBundle.basePath}/${icon}`) : null, airborne: airborne ? rootAsset(`${variantData ? basePath : baseBundle.basePath}/${airborne}`) : null, layeredAirborne, motionData: baseEntry.motionData || null, displayScale: Number(baseEntry.displayScale) || 1, variant: selected };
  }
  function selectedVariantBundle(variant) { return variant !== 'normal' && snapshot?.assets?.manifests?.some((item) => item.id === 'fish-variants'); }
  function preloadActionImage(bundle, action) {
    if (!bundle || !action?.file) return Promise.resolve(false);
    const url = rootAsset(`${bundle.basePath}/${action.file}`);
    if (decodedActionImages.has(url)) return Promise.resolve(true);
    if (actionImages.has(url)) return actionImages.get(url).promise;
    const image = new Image();
    const promise = new Promise((resolve) => {
      image.onload = () => {
        const decoded = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve();
        decoded.finally(() => { decodedActionImages.add(url); resolve(true); });
      };
      image.onerror = () => resolve(false);
      image.src = url;
    });
    actionImages.set(url, { image, promise });
    return promise;
  }
  function preloadAllActions(bundle) {
    for (const action of Object.values(bundle?.data?.actions || {})) preloadActionImage(bundle, action);
  }
  function renderSprite() {
    const state = snapshot.state;
    const actionId = actionForState(state);
    const bundle = manifest('pet');
    if (bundle?.basePath !== actionBundleKey) {
      actionBundleKey = bundle?.basePath;
      actionImages.clear(); decodedActionImages.clear();
      document.body.dataset.character = snapshot.characters?.selectedId || 'classic';
    }
    const action = bundle?.data?.actions?.[actionId] || bundle?.data?.actions?.[bundle?.data?.defaultAction];
    requestedAction = actionId;
    preloadAllActions(bundle);
    const actionUrl = action?.file ? rootAsset(`${bundle.basePath}/${action.file}`) : null;
    if (action && !decodedActionImages.has(actionUrl)) {
      preloadActionImage(bundle, action).then((ready) => {
        if (ready && requestedAction === actionId && actionForState(snapshot.state) === actionId) renderSprite();
      });
      // Keep the fully decoded previous action visible until the requested
      // strip is ready. On first load the canonical fallback fills the gap.
      if (currentAction && !$('sprite').hidden) return;
    }
    clearInterval(animationTimer);
    clearTimeout(blinkTimer);
    if (!action) {
      $('sprite').hidden = true;
      $('fallbackSprite').hidden = false;
      $('fallbackSprite').src = rootAsset(snapshot.assets.fallbackPet);
      currentAction = actionId;
      renderCatch();
      return;
    }
    if (!decodedActionImages.has(actionUrl)) {
      $('sprite').hidden = true;
      $('fallbackSprite').hidden = false;
      $('fallbackSprite').src = rootAsset(snapshot.assets.fallbackPet);
      return;
    }
    document.body.dataset.action = actionId;
    $('fallbackSprite').hidden = true;
    $('sprite').hidden = false;
    const frameCount = Math.max(1, Number(action.frameCount));
    $('sprite').style.backgroundImage = `url("${actionUrl}")`;
    $('sprite').style.backgroundSize = `${frameCount * 100}% 100%`;
    currentAction = actionId;
    const draw = () => {
      if (currentAction !== actionForState(snapshot.state)) return;
      const elapsed = PondPetLayout.actionElapsed(Date.now(), snapshot.state.stateStartedAt, visualOverride);
      let frame;
      const blinkMeta = action.animationMeta || action;
      if (blinkMeta.type === 'idle_blink' && Array.isArray(blinkMeta.baseFrameSequence)) {
        // Idle-like actions use only open-eye frames as their stable loop. A
        // blink is scheduled independently at a randomized low frequency.
        const sequence = blinkMeta.baseFrameSequence;
        frame = sequence[Math.floor(elapsed / 700) % sequence.length];
      } else if (Array.isArray(action.frameDurationsMs) && action.frameDurationsMs.length === frameCount) {
        const total = action.frameDurationsMs.reduce((sum, value) => sum + value, 0);
        let cursor = action.loop ? elapsed % total : Math.min(elapsed, total - 1);
        frame = 0;
        while (frame < frameCount - 1 && cursor >= action.frameDurationsMs[frame]) cursor -= action.frameDurationsMs[frame++];
      } else {
        const duration = Math.max(16, Number(action.frameDurationMs) || 150);
        frame = action.loop ? Math.floor(elapsed / duration) % frameCount : Math.min(frameCount - 1, Math.floor(elapsed / duration));
      }
      document.body.dataset.actionFrame = String(frame);
      $('sprite').style.backgroundPosition = frameCount === 1 ? '0 0' : `${frame / (frameCount - 1) * 100}% 0`;
      renderCatch(frame, action);
    };
    draw();
    const blinkMeta = action.animationMeta || action;
    if (blinkMeta.type === 'idle_blink' && Array.isArray(blinkMeta.blinkFrameSequences)) {
      const scheduleBlink = () => {
        const range = blinkMeta.blinkIntervalMs || { min: 8000, max: 15000 };
        const wait = Number(range.min) + Math.random() * (Number(range.max) - Number(range.min));
        blinkTimer = setTimeout(() => {
          const playBlink = (onComplete) => {
            const sequence = blinkMeta.blinkFrameSequences[Math.floor(Math.random() * blinkMeta.blinkFrameSequences.length)] || [0, 1, 2];
            let i = 0;
            const advance = () => {
              if (currentAction !== actionId) return;
              const frame = sequence[Math.min(i, sequence.length - 1)];
              document.body.dataset.actionFrame = String(frame);
              $('sprite').style.backgroundPosition = `${frame / (frameCount - 1) * 100}% 0`;
              if (++i < sequence.length) blinkTimer = setTimeout(advance, 110);
              else onComplete();
            };
            advance();
          };
          const finish = () => { draw(); scheduleBlink(); };
          playBlink(() => {
            if (Math.random() >= Number(blinkMeta.doubleBlinkChance || 0)) return finish();
            const gap = blinkMeta.doubleBlinkGapMs || { min: 180, max: 300 };
            const delay = Number(gap.min) + Math.random() * (Number(gap.max) - Number(gap.min));
            blinkTimer = setTimeout(() => playBlink(finish), delay);
          });
        }, wait);
      };
      scheduleBlink();
    }
    animationTimer = setInterval(draw, action.loop ? 100 : 40);
  }
  function renderCatch(frame = 0, action) {
    const state = snapshot.state;
    const special = state.pendingCatch?.encounterType === 'special' || state.currentResult?.type === 'special';
    const fishId = state.pendingCatch?.fishId || state.currentResult?.resultId;
    const node = $('catchSprite');
    const visible = ['reel_pull', 'catch_flight', 'catch_land', 'celebrating'].includes(state.fishingState) && (fishId || special);
    node.hidden = !visible;
    if (!visible) return;
    if (special) {
      const eventId = state.pendingCatch?.eventId || state.currentResult?.eventId;
      const event = snapshot.specialEventCatalog?.find((item) => item.id === eventId);
      const elapsed = Math.max(0, Date.now() - state.stateStartedAt);
      const duration = Math.max(1, state.stateEndsAt - state.stateStartedAt);
      const progress = Math.min(0.999, elapsed / duration);
      const frameCount = Math.max(1, Number(event?.frameCount) || 6);
      const pose = Math.min(frameCount - 1, PondSpecialEvents.animationPose(state.fishingState, progress));
      const anchor = action?.frames?.[frame]?.fishAnchor;
      let x = 154, y = 130, rotation = 0;
      if (anchor) { x = anchor.x; y = anchor.y; rotation = anchor.rotationDeg || 0; }
      else if (state.fishingState === 'catch_flight') { const inverse = 1 - progress; x = inverse * inverse * 175 + 2 * inverse * progress * 118 + progress * progress * 82; y = inverse * inverse * 148 + 2 * inverse * progress * 34 + progress * progress * 150; rotation = -30 + progress * 120; }
      else if (['catch_land', 'celebrating'].includes(state.fishingState)) { x = 84; y = 151; rotation = -8; }
      const sourceWidth = Number(event?.frameWidth) || 256;
      const sourceHeight = Number(event?.frameHeight) || 256;
      const displayWidth = Number(event?.displaySize) || 64;
      const displayHeight = displayWidth * sourceHeight / sourceWidth;
      const hook = { x: (event?.hookAnchor?.x ?? sourceWidth / 2) * displayWidth / sourceWidth,
        y: (event?.hookAnchor?.y ?? sourceHeight / 2) * displayHeight / sourceHeight };
      node.classList.remove('layered-airborne', 'unknown'); node.replaceChildren();
      node.style.width = `${displayWidth}px`; node.style.height = `${displayHeight}px`;
      node.style.imageRendering = 'auto';
      node.style.backgroundImage = event?.animationPath ? `url("${rootAsset(event.animationPath)}")` : 'none';
      node.style.backgroundSize = `${frameCount * 100}% 100%`;
      node.style.backgroundPosition = `${frameCount > 1 ? pose / (frameCount - 1) * 100 : 0}% 0`;
      node.style.left = `${x - hook.x}px`; node.style.top = `${y - hook.y}px`; node.style.transformOrigin = `${hook.x}px ${hook.y}px`; node.style.transform = `rotate(${rotation}deg) scale(${anchor?.scale || 1})`; node.style.zIndex = anchor?.z === 'behind' ? '2' : anchor?.z === 'boat' ? '5' : '8';
      return;
    }
    node.style.width = '64px'; node.style.height = '64px'; node.style.imageRendering = '';
    const asset = fishAsset(fishId, state.pendingCatch?.variant || state.currentResult?.variant || 'normal');
    const anchor = action?.frames?.[frame]?.fishAnchor;
    const elapsed = Math.max(0, Date.now() - state.stateStartedAt);
    let x = 154, y = 130, rotation = 0, pose = frame % 4, scale = asset.displayScale || 1;
    if (anchor) {
      x = anchor.x; y = anchor.y; rotation = anchor.rotationDeg || 0; pose = anchor.pose || 0; scale *= anchor.scale || 1;
    } else if (state.fishingState === 'catch_flight') {
      const duration = Math.max(1, state.stateEndsAt - state.stateStartedAt);
      const progress = Math.min(1, elapsed / duration);
      const inverse = 1 - progress;
      x = inverse * inverse * 175 + 2 * inverse * progress * 118 + progress * progress * 82;
      y = inverse * inverse * 148 + 2 * inverse * progress * 34 + progress * progress * 150;
      rotation = -30 + progress * 120;
      const sequence = asset.motionData?.flightPoseSequence || [0, 1, 2, 3, 2, 1, 0, 1, 2, 0];
      pose = sequence[Math.min(9, Math.floor(progress * 10))];
    } else if (['catch_land', 'celebrating'].includes(state.fishingState)) {
      x = 84; y = 151; rotation = -8; pose = Math.floor(elapsed / 180) % 2;
    }
    const hook = asset.motionData?.frames?.[pose]?.hookAnchor || { x: 50, y: 22 };
    node.style.left = `${x - hook.x}px`; node.style.top = `${y - hook.y}px`;
    node.style.transformOrigin = `${hook.x}px ${hook.y}px`;
    node.style.transform = `rotate(${rotation}deg) scale(${scale})`;
    node.style.zIndex = anchor?.z === 'behind' ? '2' : anchor?.z === 'boat' ? '5' : '8';
    node.classList.remove('unknown');
    if (asset.variant === 'iridescent' && asset.layeredAirborne) {
      if (!node.querySelector('.airborne-base')) node.innerHTML = '<i class="airborne-base"></i><i class="airborne-cloud"></i><i class="airborne-ribbon"></i><i class="airborne-glint"></i><i class="airborne-detail"></i>';
      node.classList.add('layered-airborne');
      const base = node.querySelector('.airborne-base'); base.style.backgroundImage = `url("${asset.layeredAirborne.base}")`; base.style.backgroundSize = '400% 100%'; base.style.backgroundPosition = `${pose / 3 * 100}% 0`;
      const mask = `url("${asset.layeredAirborne.mask}")`;
      for (const layer of ['airborne-cloud', 'airborne-ribbon', 'airborne-glint']) {
        const el = node.querySelector(`.${layer}`);
        const maskPosition = `${pose / 3 * 100}% 0`;
        el.style.setProperty('--mask', mask);
        el.style.maskPosition = maskPosition;
        el.style.webkitMaskPosition = maskPosition;
      }
      const detail = node.querySelector('.airborne-detail'); detail.style.backgroundImage = `url("${asset.layeredAirborne.detail}")`; detail.style.backgroundSize = '400% 100%'; detail.style.backgroundPosition = `${pose / 3 * 100}% 0`;
    } else if (asset.airborne) {
      node.classList.remove('layered-airborne');
      node.replaceChildren();
      node.style.backgroundImage = `url("${asset.airborne}")`; node.style.backgroundSize = '400% 100%'; node.style.backgroundPosition = `${pose / 3 * 100}% 0`;
    } else if (asset.icon) {
      node.classList.remove('layered-airborne'); node.replaceChildren();
      node.style.backgroundImage = `url("${asset.icon}")`; node.style.backgroundSize = 'contain'; node.style.backgroundPosition = 'center';
    } else { node.classList.remove('layered-airborne'); node.replaceChildren(); node.classList.add('unknown'); node.style.backgroundImage = 'none'; }
  }
  function render() {
    if (!snapshot) return;
    const state = snapshot.state;
    for (const cue of PondSounds.cuesForTransition(previousFishingState, state.fishingState, state.currentResult)) playSoundCue(cue);
    previousFishingState = state.fishingState;
    document.body.dataset.state = state.fishingState;
    document.documentElement.style.setProperty('--pet-scale', state.settings.petScale);
    $('biteSignal').hidden = !bitingStates.has(state.fishingState);
    $('quickCast').disabled = state.fishingState !== 'idle';
    $('quickReel').disabled = !(['waiting', 'casting'].includes(state.fishingState) || bitingStates.has(state.fishingState));
    $('quickReel').title = bitingStates.has(state.fishingState) ? '立即收杆' : '提前收杆';
    const habitat = state.activeHabitat === 'saltwater' ? 'saltwater' : 'freshwater';
    $('quickSceneIcon').src = `../assets/ui/icons/${habitat}.svg`;
    $('quickScene').title = `${habitat === 'saltwater' ? '咸水' : '淡水'}垂钓池 · 点击切换`;
    $('quickScene').disabled = state.fishingState !== 'idle';
    $('sceneFreshwater').setAttribute('aria-pressed', String(habitat === 'freshwater'));
    $('sceneSaltwater').setAttribute('aria-pressed', String(habitat === 'saltwater'));
    $('sceneSaltwater').disabled = !Array.isArray(state.ownedPacks) || !state.ownedPacks.some((pack) => pack === 'S1' || pack === 'S2');
    updateCastTimer(state);
    renderSprite();
  }
  function updateCastTimer(state) {
    const node = $('castTimer');
    const visible = Boolean(state.settings.showCastTimer !== false) && ['casting', 'waiting'].includes(state.fishingState);
    node.hidden = !visible;
    clearInterval(castTimerInterval);
    if (!visible) return;
    const started = Number(state.castTimerStartedAt || state.stateStartedAt || Date.now());
    const paint = () => {
      const elapsed = Math.max(0, Date.now() - started);
      const seconds = Math.floor(elapsed / 1000);
      node.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };
    paint(); castTimerInterval = setInterval(paint, 250);
  }
  function playSoundCue(name) {
    if (snapshot.state.settings.muted || !snapshot.state.settings.sounds) return;
    try {
      audioContext ||= new AudioContext();
      audioContext.resume?.();
      const patterns = {
        cast: [[250, .04, .08], [330, .03, .06]],
        bite: [[520, .04, .1], [680, .05, .1]],
        breach: [[300, .035, .08], [450, .035, .08]],
        land: [[190, .045, .11]],
        rare: [[440, .03, .09], [570, .035, .09], [760, .04, .14]]
      };
      let offset = 0;
      for (const [frequency, volume, duration] of patterns[name] || []) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + offset;
        oscillator.type = name === 'land' ? 'triangle' : 'square';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(.001, start + duration);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start); oscillator.stop(start + duration + .01);
        offset += duration * .72;
      }
    } catch { /* Sound is optional and never blocks fishing. */ }
  }
  function feedback(text) {
    $('petFeedback').textContent = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { $('petFeedback').textContent = ''; }, 1800);
  }
  function resetQuickTimer() { clearTimeout(quickTimer); quickTimer = setTimeout(hideQuickTools, 10000); }
  function showQuickTools() { $('quickTools').hidden = false; $('scenePicker').hidden = true; resetQuickTimer(); }
  function hideQuickTools() { $('quickTools').hidden = true; $('scenePicker').hidden = true; clearTimeout(quickTimer); }
  function updateClickThrough(event) {
    if (drag) return;
    const scale = snapshot?.state?.settings?.petScale || 1;
    const bodyHit = PondPetLayout.isPetInteractivePoint(event.clientX, event.clientY, scale, petBodyLeft, innerHeight);
    const pickerOpen = !$('scenePicker').hidden;
    const toolsMinX = petToolSide === 'left' && pickerOpen ? petToolLeft - 94 : petToolLeft - 4;
    const toolsMaxX = petToolSide === 'right' && pickerOpen ? petToolLeft + 138 : petToolLeft + 48;
    const toolsHit = !$('quickTools').hidden && event.clientX >= toolsMinX && event.clientX <= toolsMaxX && event.clientY >= 38 && event.clientY <= 224;
    const shouldIgnore = !(bodyHit || toolsHit);
    if (shouldIgnore !== clickThrough) {
      clickThrough = shouldIgnore;
      window.desktopPond.setClickThrough(shouldIgnore);
    }
  }
  async function perform(action) {
    try {
      const result = await window.desktopPond.action(action, { corner });
      if (!result.ok) feedback('现在不能这样操作');
      else if (result.snapshot?.app?.persistenceError) feedback('存档写入失败，请打开面板检查');
    } catch { feedback('操作失败，请稍后再试'); }
    hideQuickTools();
  }
  async function switchHabitat(habitat) {
    try {
      const result = await window.desktopPond.economyAction('switch-habitat', { habitat });
      if (result?.snapshot) snapshot = result.snapshot;
      if (!result?.ok) feedback(result?.reason === 'locked-habitat' ? '先在商店解锁咸水鱼包' : result?.reason === 'fishing-active' ? '收杆后再切换水域' : '暂时无法切换');
      else feedback(habitat === 'saltwater' ? '已切换到咸水垂钓池' : '已切换到淡水垂钓池');
      $('scenePicker').hidden = true;
      render();
      resetQuickTimer();
    } catch { feedback('场景切换失败，请稍后再试'); }
  }
  async function beginDrag(event) {
    if (event.button !== 0 || event.target.closest('.quick-tools')) return;
    const bounds = await window.desktopPond.getPetBounds();
    // IPC movement is window-origin based; bodyTop is only for hit testing.
    drag = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, bodyX: bounds.x + petBodyLeft, windowY: bounds.y, moved: false };
    $('petBody').setPointerCapture(event.pointerId);
  }
  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId || !(event.buttons & 1)) return;
    const dx = event.screenX - drag.startX;
    const dy = event.screenY - drag.startY;
    if (Math.hypot(dx, dy) <= 6 && !drag.moved) return;
    drag.moved = true; hideQuickTools(); window.desktopPond.movePet(drag.bodyX + dx, drag.windowY + dy);
  }
  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasMoved = drag.moved; drag = null;
    try { $('petBody').releasePointerCapture(event.pointerId); } catch {}
    if (!wasMoved) {
      if (bitingStates.has(snapshot.state.fishingState)) perform('reel');
      else setVisualOverride('click_react');
    }
  }
  $('petBody').addEventListener('pointerdown', beginDrag);
  $('petBody').addEventListener('pointermove', moveDrag);
  $('petBody').addEventListener('pointerup', endDrag);
  $('petBody').addEventListener('pointercancel', () => { drag = null; });
  $('petBody').addEventListener('lostpointercapture', () => { drag = null; });
  $('petBody').addEventListener('contextmenu', (event) => { event.preventDefault(); setVisualOverride('menu_greet'); showQuickTools(); });
  $('quickTools').addEventListener('pointermove', resetQuickTimer);
  $('quickTools').addEventListener('focusin', resetQuickTimer);
  $('quickCast').addEventListener('click', () => perform('cast'));
  $('quickReel').addEventListener('click', () => perform(bitingStates.has(snapshot.state.fishingState) ? 'reel' : 'early-reel'));
  $('quickScene').addEventListener('click', () => {
    $('scenePicker').hidden = !$('scenePicker').hidden;
    resetQuickTimer();
  });
  $('sceneFreshwater').addEventListener('click', () => switchHabitat('freshwater'));
  $('sceneSaltwater').addEventListener('click', () => switchHabitat('saltwater'));
  $('quickPanel').addEventListener('click', async () => {
    hideQuickTools();
    try {
      const result = await window.desktopPond.openPanel({ page: 'home' });
      if (result?.ok === false) feedback(result.message || '信息面板打开失败，请重试');
    } catch { feedback('信息面板打开失败，请重试'); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideQuickTools(); });
  document.addEventListener('mousemove', updateClickThrough);
  window.addEventListener('blur', () => { hideQuickTools(); drag = null; });
  window.desktopPond.onUpdate((value) => { snapshot = value; render(); });
  window.desktopPond.onCorner((value) => { corner = value; });
  window.desktopPond.onPetLayout((value) => {
    petToolSide = value?.side === 'left' ? 'left' : 'right';
    petBodyLeft = petToolSide === 'left' ? Number(value?.reserve) || 0 : 0;
    petBodyTop = Number(value?.bodyTop) || 0;
    petToolLeft = Number(value?.toolLeft) || (petToolSide === 'left' ? 8 : 216);
    document.documentElement.style.setProperty('--pet-body-left', `${petBodyLeft}px`);
    document.documentElement.style.setProperty('--pet-tool-left', `${petToolLeft}px`);
    document.body.dataset.toolSide = petToolSide;
  });
  window.desktopPond.getSnapshot().then(async (value) => {
    snapshot = value;
    if (!value.state.castCount && !value.state.history.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem('screen-fishing-state-v1'));
        if (legacy) {
          snapshot = await window.desktopPond.importLegacyState(legacy);
          localStorage.removeItem('screen-fishing-state-v1');
        }
      } catch { /* Invalid legacy data is ignored. */ }
    }
    render(); scheduleYawn();
  }).catch(() => feedback('状态加载失败'));
})();
