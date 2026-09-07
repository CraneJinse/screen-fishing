(function exposeShortcutSettings(globalScope) {
  'use strict';

  const MODIFIERS = new Map([
    ['ctrl', 'CommandOrControl'], ['control', 'CommandOrControl'],
    ['commandorcontrol', 'CommandOrControl'], ['cmdorctrl', 'CommandOrControl'],
    ['alt', 'Alt'], ['option', 'Alt'], ['shift', 'Shift'],
    ['super', 'Super'], ['meta', 'Super'], ['command', 'Command']
  ]);
  const NAMED_KEYS = new Map([
    ['space', 'Space'], ['tab', 'Tab'], ['escape', 'Escape'], ['esc', 'Escape'],
    ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'],
    ['home', 'Home'], ['end', 'End'], ['pageup', 'PageUp'], ['pagedown', 'PageDown'],
    ['insert', 'Insert'], ['delete', 'Delete'], ['backspace', 'Backspace'], ['enter', 'Enter']
  ]);

  function normalizeAccelerator(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const raw = value.trim().replace(/\s+/g, '');
    if (!raw) return null;
    const tokens = raw.split('+').filter(Boolean);
    if (tokens.length < 2) return null;
    const modifiers = [];
    let key = null;
    for (const token of tokens) {
      const lower = token.toLowerCase();
      const modifier = MODIFIERS.get(lower);
      if (modifier) {
        if (!modifiers.includes(modifier)) modifiers.push(modifier);
        continue;
      }
      const named = NAMED_KEYS.get(lower);
      const candidate = named || (/^f(?:[1-9]|1\d|2[0-4])$/i.test(token) ? token.toUpperCase() : /^[a-z0-9]$/i.test(token) ? token.toUpperCase() : null);
      if (!candidate || key) return null;
      key = candidate;
    }
    if (!key || modifiers.length < 1) return null;
    const order = ['CommandOrControl', 'Command', 'Super', 'Alt', 'Shift'];
    modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return [...modifiers, key].join('+');
  }

  function displayAccelerator(value) {
    return String(value || '').replace('CommandOrControl', 'Ctrl').replace('Command', 'Cmd').replace('Super', 'Win');
  }

  function validateShortcutChange(kind, value, current) {
    const kinds = ['pet', 'panel', 'fishing', 'aquarium'];
    if (!kinds.includes(kind)) return { ok: false, error: '未知快捷键类型' };
    const accelerator = normalizeAccelerator(value);
    if (!accelerator) return { ok: false, error: '请输入组合键，例如 Ctrl+Shift+M' };
    const duplicated = kinds.some((otherKind) => otherKind !== kind && accelerator === current?.[otherKind]);
    if (duplicated) return { ok: false, error: '不同功能不能使用同一个快捷键' };
    return { ok: true, accelerator };
  }

  const api = { normalizeAccelerator, displayAccelerator, validateShortcutChange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PondShortcuts = api;
})(typeof window !== 'undefined' ? window : globalThis);
