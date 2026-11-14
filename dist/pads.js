// Gamepads and Keyboard on the page (docs/APP.md "Gamepads", "Pad parity"):
// reading the Gamepad API every frame, saved settings, the controllers dialog
// with both Gamepad and Keyboard remapping, and the scripted pads of ?pads=.
// The core (WebApp.pad_*) does pad mapping, joining and menu repeat; app.js
// turns menu events into actions.

/** melee_menu_event_e bits. */
export const MENU = {
  up: 1 << 0, down: 1 << 1, left: 1 << 2, right: 1 << 3, confirm: 1 << 4, back: 1 << 5, x: 1 << 6, y: 1 << 7,
  l: 1 << 8, r: 1 << 9, z: 1 << 10, start: 1 << 11, menu: 1 << 12, joined: 1 << 16, bound: 1 << 17,
};
/** W3C standard gamepad controls (melee_pad_input_e). */
const INPUTS = 17;
const PREFS_KEY = 'melee.padPrefs';
const KEY_PREFS_KEY = 'melee.keyPrefs';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child != null) node.append(child);
  return node;
};

// ---- Keyboard bindings & persistence --------------------------------------

export const DEFAULT_KEYS = {
  // Player 1
  0: {
    left: 'KeyA',
    right: 'KeyD',
    up: 'KeyW',
    down: 'KeyS',
    attack: 'KeyK',
    special: 'KeyJ',
    jump: 'Space',
    shield: 'KeyL',
    grab: 'KeyI',
  },
  // Player 2
  1: {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    attack: 'KeyN',
    special: 'KeyM',
    jump: 'Comma',
    shield: 'Period',
    grab: 'Slash',
  },
};

let currentKeyPrefs = JSON.parse(JSON.stringify(DEFAULT_KEYS));
let currentKeyMap = {};
let keyListening = null; // { player, action }
let activePadsInstance = null;

export function formatKeyCode(code) {
  if (!code) return 'None';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  switch (code) {
    case 'Space': return 'Space';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Slash': return '/';
    case 'Semicolon': return ';';
    case 'Quote': return "'";
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Backslash': return '\\';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'Backspace': return 'Bksp';
    case 'Enter': return 'Enter';
    case 'ShiftLeft': return 'L-Shift';
    case 'ShiftRight': return 'R-Shift';
    case 'ControlLeft': return 'L-Ctrl';
    case 'ControlRight': return 'R-Ctrl';
    case 'AltLeft': return 'L-Alt';
    case 'AltRight': return 'R-Alt';
    case 'Tab': return 'Tab';
    case 'Escape': return 'Esc';
    default: return code;
  }
}

export function rebuildKeyMap() {
  currentKeyMap = {};
  for (const [pStr, actions] of Object.entries(currentKeyPrefs)) {
    const p = Number(pStr);
    for (const [action, code] of Object.entries(actions)) {
      if (code) {
        currentKeyMap[code] = [p, action];
      }
    }
  }
}

export function getKeyMap() {
  return currentKeyMap;
}

export function getKeyPrefs() {
  return currentKeyPrefs;
}

export function loadKeyPrefs() {
  try {
    const saved = localStorage.getItem(KEY_PREFS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        currentKeyPrefs = {
          0: { ...DEFAULT_KEYS[0], ...(parsed[0] || {}) },
          1: { ...DEFAULT_KEYS[1], ...(parsed[1] || {}) },
        };
      }
    }
  } catch {}
  rebuildKeyMap();
}

export function saveKeyPrefs() {
  try {
    localStorage.setItem(KEY_PREFS_KEY, JSON.stringify(currentKeyPrefs));
  } catch {}
  rebuildKeyMap();
}

export function setKeyPref(player, action, code) {
  if (!currentKeyPrefs[player]) currentKeyPrefs[player] = {};
  for (const [otherAction, otherCode] of Object.entries(currentKeyPrefs[player])) {
    if (otherAction !== action && otherCode === code) {
      currentKeyPrefs[player][otherAction] = currentKeyPrefs[player][action];
    }
  }
  currentKeyPrefs[player][action] = code;
  saveKeyPrefs();
}

export function resetKeyPrefs(player) {
  if (player != null) {
    currentKeyPrefs[player] = { ...DEFAULT_KEYS[player] };
  } else {
    currentKeyPrefs = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  }
  saveKeyPrefs();
}

loadKeyPrefs();

// Capture keyboard listening when rebinding in controllers dialog
window.addEventListener('keydown', (e) => {
  if (keyListening) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      setKeyPref(keyListening.player, keyListening.action, e.code);
    }
    keyListening = null;
    activePadsInstance?.onChange();
  }
}, { capture: true });

// --------------------------------------------------------------------------

export const CUSTOM_PAD_PREFIX = 'melee.customPad.';

export function getCustomProfile(padId) {
  if (!padId) return null;
  try {
    const raw = localStorage.getItem(CUSTOM_PAD_PREFIX + padId);
    if (raw) return JSON.parse(raw);
    const bundle = localStorage.getItem('melee.customProfiles');
    if (bundle) {
      const parsed = JSON.parse(bundle);
      if (parsed && parsed[padId]) return parsed[padId];
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCustomProfile(padId, profile) {
  if (!padId) return;
  try {
    localStorage.setItem(CUSTOM_PAD_PREFIX + padId, JSON.stringify(profile));
  } catch {}
}

export function clearCustomProfile(padId) {
  if (!padId) return;
  try {
    localStorage.removeItem(CUSTOM_PAD_PREFIX + padId);
  } catch {}
}

export function formatInputSource(src) {
  if (!src) return 'Unbound';
  if (src.type === 'button') {
    return `Button #${src.index}`;
  }
  if (src.type === 'axis') {
    return `Axis #${src.index} ${src.dir > 0 ? '(+)' : '(-)'}`;
  }
  return String(src);
}

function readSource(pad, source) {
  if (!source) return 0;
  if (source.type === 'button') {
    const b = pad.buttons[source.index];
    if (!b) return 0;
    return typeof b.value === 'number' ? b.value : (b.pressed ? 1.0 : 0.0);
  }
  if (source.type === 'axis') {
    const ax = pad.axes[source.index];
    if (typeof ax !== 'number' || Number.isNaN(ax)) return 0;
    const rest = typeof source.rest === 'number' ? source.rest : 0.0;
    // For trigger axes resting near -1.0 (LT/RT):
    if (rest <= -0.7) {
      return ax > -0.3 ? Math.min(1.0, (ax + 1.0) / 2.0) : 0.0;
    }
    // Ignore invalid hat switch axes or out-of-range floats
    if (rest < -1.1 || rest > 1.1) {
      return 0.0;
    }
    const diff = ax - rest;
    if (source.dir > 0 && diff > 0.45) return 1.0;
    if (source.dir < 0 && diff < -0.45) return 1.0;
    return 0;
  }
  return 0;
}

export const CALIBRATION_STEPS = [
  { key: 'a', name: 'Attack (A)', desc: 'Attack button: punches, kicks, aerials, and smash attacks', glyph: 'A', buttonsOnly: true },
  { key: 'b', name: 'Special (B)', desc: 'Special move button: Link\'s bow, Kirby abilities, fireballs, and recovery', glyph: 'B', buttonsOnly: true },
  { key: 'x', name: 'Jump (X)', desc: 'Jump button / short hop', glyph: 'X', buttonsOnly: true },
  { key: 'y', name: 'Jump (Y)', desc: 'Jump button / short hop', glyph: 'Y', buttonsOnly: true },
  { key: 'z', name: 'Grab / Hookshot (Z)', desc: 'Grab opponents, fire Link\'s hookshot & Samus grapple in air', glyph: 'Z', buttonsOnly: true },
  { key: 'l', name: 'Shield (L)', desc: 'Shield on ground, air dodge in air (Left trigger or bumper)', glyph: 'L', buttonsOnly: false },
  { key: 'r', name: 'Shield (R)', desc: 'Shield on ground, air dodge in air (Right trigger or bumper)', glyph: 'R', buttonsOnly: false },
  { key: 'start', name: 'Start / Pause', desc: 'Pause match, confirm menus (+ / Start)', glyph: 'Start', buttonsOnly: true },
  { key: 'dpadUp', name: 'D-Pad UP', desc: 'D-pad Up: taunt up / menu up', glyph: 'D ↑', buttonsOnly: true },
  { key: 'dpadDown', name: 'D-Pad DOWN', desc: 'D-pad Down: taunt down / menu down', glyph: 'D ↓', buttonsOnly: true },
  { key: 'dpadLeft', name: 'D-Pad LEFT', desc: 'D-pad Left: taunt left / menu left', glyph: 'D ←', buttonsOnly: true },
  { key: 'dpadRight', name: 'D-Pad RIGHT', desc: 'D-pad Right: taunt right / menu right', glyph: 'D →', buttonsOnly: true },
];

let wizardState = null;
let singleListening = null;

/**
 * Connected pads: `poll(now)` reports each to the core every animation
 * frame on every screen and hands its menu events to `onEvents(events,
 * handle)`; `onChange()` runs when pads come, go or change settings.
 */
export class Pads {
  constructor(app, { onEvents, onChange }) {
    Object.assign(this, { app, onEvents, onChange });
    activePadsInstance = this;
    this.connected = new Map(); // Gamepad.index -> Gamepad.id
    this.fake = null;
    this.buttons = new Float32Array(INPUTS);
    this.axes = new Float32Array(4);
    try {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) app.pad_load_prefs(saved);
    } catch { /* storage unavailable: defaults */ }
    try {
      fetch('/api/controller-profile')
        .then((r) => r.json())
        .then((profile) => {
          if (profile && profile.id && profile.bindings) {
            saveCustomProfile(profile.id, profile.bindings);
            for (const pad of this.list()) {
              if (pad.name === profile.id || profile.id.includes(pad.familyName)) {
                this.app.pad_apply_preset(pad.handle, 'custom_direct');
              }
            }
          }
        })
        .catch(() => {});
    } catch {}
  }
  get count() { return this.connected.size; }
  /** Every connected pad's state (WebApp.pads()). */
  list() { return this.app.pads(); }
  info(handle) { return this.list().find((p) => p.handle === handle); }
  save() {
    try { localStorage.setItem(PREFS_KEY, this.app.pad_prefs()); } catch { /* private mode: not kept */ }
  }
  gamepads() {
    const real = [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);
    return this.fake ? real.concat(this.fake.gamepads()) : real;
  }
  poll(now) {
    const seen = new Set();
    let changed = false;

    // Process Guided Wizard Step Detection
    if (wizardState) {
      const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.id === wizardState.padId);
      if (gp) {
        if (!wizardState.baselineAxes || wizardState.baselineAxes.length !== gp.axes.length) {
          wizardState.baselineAxes = [...gp.axes];
        }
        const currentStep = CALIBRATION_STEPS[wizardState.stepIndex];
        if (wizardState.waitingRelease) {
          const cap = wizardState.captured;
          let isReleased = false;
          if (cap) {
            if (cap.type === 'button') {
              const b = gp.buttons[cap.index];
              isReleased = !b || (!b.pressed && (typeof b.value !== 'number' || b.value < 0.2));
            } else if (cap.type === 'axis') {
              const base = wizardState.baselineAxes[cap.index] || 0;
              const val = gp.axes[cap.index] || 0;
              isReleased = Math.abs(val - base) < 0.25;
            } else {
              isReleased = true;
            }
          } else {
            isReleased = true;
          }
          if (isReleased) {
            wizardState.waitingRelease = false;
            wizardState.captured = null;
            wizardState.baselineAxes = [...gp.axes];
            if (this.onChange) this.onChange();
          }
        } else {
          let captured = null;
          for (let i = 0; i < gp.buttons.length; i++) {
            const b = gp.buttons[i];
            if (b && (b.pressed || b.value > 0.5)) {
              captured = { type: 'button', index: i };
              break;
            }
          }
          if (!captured && !currentStep.buttonsOnly) {
            for (let j = 0; j < Math.min(gp.axes.length, 6); j++) {
              const val = gp.axes[j];
              const base = wizardState.baselineAxes[j] || 0;
              const diff = val - base;
              if (Math.abs(diff) > 0.45) {
                captured = { type: 'axis', index: j, dir: diff > 0 ? 1 : -1 };
                break;
              }
            }
          }
          if (captured && (!wizardState.lastAdvance || Date.now() - wizardState.lastAdvance > 250)) {
            wizardState.bindings[currentStep.key] = captured;
            wizardState.captured = captured;
            wizardState.feedback = `✓ Registered: ${formatInputSource(captured)}!`;
            wizardState.waitingRelease = true;
            wizardState.lastAdvance = Date.now();
            wizardState.stepIndex++;
            if (wizardState.stepIndex >= CALIBRATION_STEPS.length) {
              saveCustomProfile(wizardState.padId, wizardState.bindings);
              this.app.pad_apply_preset(wizardState.padHandle, 'custom_direct');
              wizardState = null;
            }
            if (this.onChange) this.onChange();
          }
        }
      }
    }

    // Process Single Target Rebind
    if (singleListening) {
      const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.id === singleListening.padId);
      if (gp) {
        if (!singleListening.baselineAxes || singleListening.baselineAxes.length !== gp.axes.length) {
          singleListening.baselineAxes = [...gp.axes];
        }
        let captured = null;
        for (let i = 0; i < gp.buttons.length; i++) {
          const b = gp.buttons[i];
          if (b && (b.pressed || b.value > 0.5)) {
            captured = { type: 'button', index: i };
            break;
          }
        }
        if (!captured) {
          const stepDef = CALIBRATION_STEPS.find((s) => s.key === singleListening.targetKey);
          if (!stepDef || !stepDef.buttonsOnly) {
            for (let j = 0; j < Math.min(gp.axes.length, 6); j++) {
              const val = gp.axes[j];
              const base = singleListening.baselineAxes[j] || 0;
              const diff = val - base;
              if (Math.abs(diff) > 0.45) {
                captured = { type: 'axis', index: j, dir: diff > 0 ? 1 : -1 };
                break;
              }
            }
          }
        }
        if (captured) {
          const prof = getCustomProfile(singleListening.padId) || {};
          prof[singleListening.targetKey] = captured;
          saveCustomProfile(singleListening.padId, prof);
          this.app.pad_apply_preset(singleListening.padHandle, 'custom_direct');
          singleListening = null;
          if (this.onChange) this.onChange();
        }
      }
    }

    for (const pad of this.gamepads()) {
      seen.add(pad.index);
      if (!this.connected.has(pad.index)) {
        this.connected.set(pad.index, pad.id);
        this.app.pad_connect(pad.index, pad.id);
        // Automatically restore custom calibrated profile if present
        const existingProf = getCustomProfile(pad.id);
        if (existingProf && Object.keys(existingProf).length > 0) {
          this.app.pad_apply_preset(pad.index, 'custom_direct');
        }
        changed = true;
      }
      this.buttons.fill(0);
      this.axes.fill(0);

      // 15% Deadzone filter for analog sticks so zero-drift leaves stick centered
      const deadzone = (v, th = 0.15) => (Math.abs(v) < th ? 0.0 : v);
      this.axes[0] = deadzone(pad.axes[0] || 0, 0.15);
      this.axes[1] = deadzone(pad.axes[1] || 0, 0.15);
      this.axes[2] = deadzone(pad.axes[2] || 0, 0.15);

      // If axis 3 rests at -1.0 (Left Trigger), C-Stick Y is on axis 5
      let cstickY = pad.axes[3] || 0;
      if (pad.axes.length >= 6 && (pad.axes[3] < -0.7 || Math.abs(pad.axes[3]) > 0.8)) {
        cstickY = pad.axes[5] || 0;
      }
      this.axes[3] = deadzone(cstickY, 0.15);

      const customProf = getCustomProfile(pad.id);
      if (customProf && Object.keys(customProf).length > 0) {
        // Safe reader: if action is explicitly mapped, ONLY read that mapped source.
        // If action is unmapped/omitted, then and only then fall back to defaults.
        const btnVal = (idx) => {
          const b = pad.buttons[idx];
          if (!b) return 0.0;
          return typeof b.value === 'number' ? b.value : (b.pressed ? 1.0 : 0.0);
        };
        const readBinding = (src, ...fallbackIndices) => {
          if (src !== undefined && src !== null) {
            return readSource(pad, src);
          }
          for (const idx of fallbackIndices) {
            const v = btnVal(idx);
            if (v > 0.1) return v;
          }
          return 0.0;
        };

        const aVal = readBinding(customProf.a, 0);
        const bVal = readBinding(customProf.b, 1);
        const xVal = readBinding(customProf.x, 2);
        const yVal = readBinding(customProf.y, 3);
        // Grab / Hookshot (Z): mapped button, or fallback to RB (5) / LB (4)
        const zVal = readBinding(customProf.z, 5, 4);
        // Left Shield (L): mapped button/axis, or fallback to LT (6) / LB (4) / Ax3
        let lVal = readBinding(customProf.l, 6, 4);
        if (customProf.l === undefined && lVal <= 0.1 && pad.axes[3] !== undefined && pad.axes[3] > -0.3) {
          lVal = Math.min(1.0, (pad.axes[3] + 1.0) / 2.0);
        }
        // Right Shield (R): mapped button/axis, or fallback to RT (7) / RB (5) / Ax4
        let rVal = readBinding(customProf.r, 7, 5);
        if (customProf.r === undefined && rVal <= 0.1 && pad.axes[4] !== undefined && pad.axes[4] > -0.3) {
          rVal = Math.min(1.0, (pad.axes[4] + 1.0) / 2.0);
        }
        // Start: mapped button, or fallback to 9 / 8 / 11
        const startVal = readBinding(customProf.start, 9, 8, 11);
        // D-Pad: strictly buttons 12..15 (or customProf button mapping)
        let dUp = readBinding(customProf.dpadUp, 12);
        let dDown = readBinding(customProf.dpadDown, 13);
        let dLeft = readBinding(customProf.dpadLeft, 14);
        let dRight = readBinding(customProf.dpadRight, 15);

        // Put into this.buttons in standard W3C Gamepad order:
        this.buttons[0] = aVal;      // South: Target::A
        this.buttons[1] = bVal;      // East: Target::B
        this.buttons[2] = xVal;      // West: Target::X
        this.buttons[3] = yVal;      // North: Target::Y
        this.buttons[4] = zVal;      // LeftBumper: Target::Z
        this.buttons[5] = zVal;      // RightBumper: Target::Z
        this.buttons[6] = lVal;      // LeftTrigger: Target::L (analog 0)
        this.buttons[7] = rVal;      // RightTrigger: Target::R (analog 1)
        this.buttons[8] = 0;         // Select
        this.buttons[9] = startVal;  // Start: Target::Start
        this.buttons[10] = 0;        // LeftStick
        this.buttons[11] = 0;        // RightStick
        this.buttons[12] = dUp;      // DpadUp: Target::DpadUp
        this.buttons[13] = dDown;    // DpadDown: Target::DpadDown
        this.buttons[14] = dLeft;    // DpadLeft: Target::DpadLeft
        this.buttons[15] = dRight;   // DpadRight: Target::DpadRight

      } else {
        pad.buttons.forEach((b, i) => { if (i < INPUTS) this.buttons[i] = b.value || (b.pressed ? 1 : 0); });
        // Triggers resting at -1.0 check: only activate when pulled forward past -0.3
        if (pad.axes[3] !== undefined && pad.axes[3] > -0.3 && this.buttons[6] === 0) {
          this.buttons[6] = Math.min(1.0, (pad.axes[3] + 1.0) / 2.0);
        }
        if (pad.axes[4] !== undefined && pad.axes[4] > -0.3 && this.buttons[7] === 0) {
          this.buttons[7] = Math.min(1.0, (pad.axes[4] + 1.0) / 2.0);
        }
      }

      const events = this.app.pad_update(pad.index, this.buttons, this.axes, now);
      if (events) this.onEvents(events, pad.index);
    }
    for (const index of [...this.connected.keys()]) {
      if (!seen.has(index)) {
        this.connected.delete(index);
        this.app.pad_disconnect(index);
        changed = true;
      }
    }
    this.fake?.afterPoll();
    if (changed) this.onChange();
  }
}

// ---- The controllers dialog: Gamepads and Keyboard Remapping tabs.

const TARGET_GLYPHS = { 9: 'D ↑', 10: 'D ↓', 11: 'D ←', 12: 'D →' };
const LIVE_BUTTONS = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', '←', '→', '↓', '↑'];

const KEYBOARD_ACTION_DEFS = [
  { action: 'attack', label: 'Attack (A)', note: 'Punches, kicks, tilts, smash attacks' },
  { action: 'special', label: 'Special (B)', note: 'Fireball, recovery and special moves' },
  { action: 'jump', label: 'Jump (X/Y)', note: 'Jump / short hop' },
  { action: 'shield', label: 'Shield (L/R)', note: 'Shield on ground, air dodge in air' },
  { action: 'grab', label: 'Grab / Tether (Z)', note: 'Grab, and Link Hookshot / Samus Grapple in air' },
  { action: 'left', label: 'Move Left', note: 'Tilt stick left' },
  { action: 'right', label: 'Move Right', note: 'Tilt stick right' },
  { action: 'up', label: 'Move Up', note: 'Tilt stick up / tap jump' },
  { action: 'down', label: 'Move Down', note: 'Tilt stick down / crouch / fast fall' },
];

/**
 * Fill `root` with the settings of pad `handle` (null: the first) or keyboard controls.
 * Each control has a data-focus-id so focus survives a rebuild.
 */
export function renderControllers(root, pads, labels, handle, { onDone }) {
  const list = pads.list();
  const pad = list.find((p) => p.handle === handle) ?? list[0];
  const app = pads.app;
  const focused = document.activeElement?.dataset?.focusId;
  const edit = (change) => () => { change(pad.handle); pads.save(); pads.onChange(); };
  const button = (label, id, run, className = 'pad-button') => {
    const node = el('button', { className, textContent: label, onclick: run });
    node.dataset.focusId = id;
    return node;
  };
  const row = (title, ...controls) => el('div', { className: 'pad-row' },
    el('span', { className: 'label', textContent: title }), el('div', { className: 'pad-controls' }, ...controls));

  const children = [el('h1', { className: 'display title', textContent: 'Controllers' })];

  let activeTab = root.dataset.tab || (list.length > 0 ? 'pads' : 'keyboard');
  root.dataset.tab = activeTab;

  const tabBtn = (label, tabKey) => {
    const b = button(label, `tab.${tabKey}`, () => {
      root.dataset.tab = tabKey;
      keyListening = null;
      renderControllers(root, pads, labels, handle, { onDone });
    }, `pad-button ${activeTab === tabKey ? 'on' : ''}`);
    return b;
  };
  children.push(el('div', { style: 'display: flex; gap: 0.5rem; margin: 0.25rem 0 0.85rem;' },
    tabBtn('🎮 Gamepads', 'pads'),
    tabBtn('⌨️ Keyboard', 'keyboard')
  ));

  if (activeTab === 'pads') {
    if (!pad) {
      children.push(el('p', { className: 'pad-note', textContent: 'No controllers connected. Connect a controller over USB '
        + 'or Bluetooth (Switch Pro, Joy-Con, DualSense, DualShock 4, Xbox, 8BitDo) or a GameCube adapter and press a '
        + 'button on it; it appears here. Browsers show a pad only after one of its buttons is pressed.' }));
      children.push(el('div', { style: 'margin: 0.75rem 0;' },
        button('Configure Keyboard Controls', 'pads.to_keyboard', () => {
          root.dataset.tab = 'keyboard';
          renderControllers(root, pads, labels, handle, { onDone });
        }, 'btn pill ghost')
      ));
    } else {
      const index = list.indexOf(pad);
      const step = (by) => () => {
        const next = list[(index + by + list.length) % list.length];
        root.dataset.handle = next.handle;
        pads.onChange();
      };
      children.push(el('div', { className: 'pad-header' },
        ...(list.length > 1 ? [button('◀', 'pads.prev', step(-1))] : []),
        el('div', {}, el('p', { className: 'pad-name', textContent: pad.name }),
          el('p', { className: 'pad-note', textContent: `${pad.familyName}${list.length > 1 ? ` · ${index + 1} of ${list.length}` : ''}` })),
        ...(list.length > 1 ? [button('▶', 'pads.next', step(1))] : [])));
      // Step-by-Step Calibration Wizard Banner / Card
      if (wizardState && wizardState.padHandle === pad.handle) {
        const currentStep = CALIBRATION_STEPS[wizardState.stepIndex];
        const card = el('div', { className: 'pad-wizard-card', style: 'background: rgba(255, 110, 30, 0.15); border: 2px solid var(--accent); border-radius: 12px; padding: 1.25rem; margin: 0.75rem 0;' },
          el('div', { style: 'display: flex; justify-content: space-between; align-items: center;' },
            el('span', { style: 'font: 800 italic 0.85rem var(--display); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent);', textContent: `STEP ${wizardState.stepIndex + 1} OF ${CALIBRATION_STEPS.length}` }),
            button('Cancel Wizard', 'wizard.cancel', () => { wizardState = null; pads.onChange(); }, 'btn pill ghost')
          ),
          el('h2', { style: 'font: 900 italic 1.5rem var(--display); margin: 0.5rem 0 0.25rem;', textContent: `Press your button for: ${currentStep.name}` }),
          el('p', { className: 'pad-note', style: 'font-size: 0.95rem; color: #fff;', textContent: currentStep.desc }),
          el('div', { style: 'display: flex; align-items: center; gap: 1rem; margin: 0.75rem 0;' },
            el('div', { style: 'font: 900 1.5rem var(--display); padding: 0.5rem 1.25rem; border-radius: 8px; background: var(--accent); color: #000;', textContent: currentStep.glyph }),
            el('div', { style: 'font: 700 1.05rem var(--ui); color: var(--accent-a);', textContent: wizardState.waitingRelease ? 'Release button to continue…' : (wizardState.feedback || 'Waiting for controller press…') })
          ),
          el('div', { style: 'display: flex; gap: 0.5rem; margin-top: 0.5rem;' },
            button('Skip this button', 'wizard.skip', () => {
              wizardState.stepIndex++;
              if (wizardState.stepIndex >= CALIBRATION_STEPS.length) {
                saveCustomProfile(wizardState.padId, wizardState.bindings);
                pads.app.pad_apply_preset(wizardState.padHandle, 'custom_direct');
                wizardState = null;
              }
              pads.onChange();
            }, 'btn pill ghost'),
            ...(wizardState.stepIndex > 0 ? [button('◀ Back', 'wizard.back', () => {
              wizardState.stepIndex--;
              pads.onChange();
            }, 'btn pill ghost')] : [])
          )
        );
        children.push(card);
      } else {
        const customProf = getCustomProfile(pad.id);
        const wizardBtn = button('🎮 Setup Buttons in Order (Guided 12-Step Wizard)', 'pads.wizard.start', () => {
          const rawGp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.id === pad.id);
          wizardState = {
            padHandle: pad.handle,
            padId: pad.id,
            stepIndex: 0,
            bindings: {},
            baselineAxes: rawGp ? [...rawGp.axes] : null,
            waitingRelease: false,
            feedback: '',
            lastAdvance: 0,
          };
          pads.onChange();
        }, 'btn accent');
        wizardBtn.style.width = '100%';
        wizardBtn.style.padding = '0.75rem 1rem';
        wizardBtn.style.margin = '0.5rem 0 0.75rem';
        wizardBtn.style.fontSize = '1.05rem';
        children.push(wizardBtn);

        const cliLinkBtn = el('a', {
          className: 'btn pill ghost',
          href: '/cli.html',
          style: 'display: block; text-align: center; margin: -0.25rem 0 0.85rem; padding: 0.5rem 1rem; color: #58a6ff; border-color: rgba(88, 166, 255, 0.4);',
          textContent: '💻 Open Dedicated Calibration CLI Screen (Terminal Mode)',
        });
        children.push(cliLinkBtn);

        if (customProf && Object.keys(customProf).length > 0) {
          children.push(el('div', { style: 'display: flex; justify-content: space-between; align-items: center; background: rgba(47, 191, 154, 0.15); border: 1px solid #2fbf9a; border-radius: 8px; padding: 0.5rem 0.85rem; margin: 0.35rem 0 0.75rem;' },
            el('span', { style: 'font: 700 0.85rem var(--ui); color: #2fbf9a;', textContent: '✓ Custom Ordered Calibration is Active & Saved for this Controller' }),
            button('Clear Custom Mapping', 'pads.custom.clear', () => {
              clearCustomProfile(pad.id);
              app.pad_apply_preset(pad.handle, 'powera');
              pads.onChange();
            }, 'btn pill ghost')
          ));
        }
      }

      children.push(row('Layout Presets',
        button('🎮 Xbox / PC (A=A, B=B)', 'pads.layout.xbox', edit((h) => {
          clearCustomProfile(pad.id);
          app.pad_apply_preset(h, 'xbox');
        })),
        button('🎮 PlayStation (✕=A, ◯=B)', 'pads.layout.ps', edit((h) => {
          clearCustomProfile(pad.id);
          app.pad_apply_preset(h, 'playstation');
        })),
        button('🎮 PowerA / GameCube (East A)', 'pads.layout.powera', edit((h) => {
          clearCustomProfile(pad.id);
          app.pad_apply_preset(h, 'powera');
        })),
        button('🎮 Classic Smash (Bottom A)', 'pads.layout.smash', edit((h) => {
          clearCustomProfile(pad.id);
          app.pad_apply_preset(h, 'smash');
        }))));

      const port = (label, value) => {
        const node = button(label, `pads.port.${value}`, edit((h) => app.pad_assign(h, value)));
        node.classList.toggle('on', pad.port === value);
        return node;
      };
      children.push(row('Player', port('None', -1), ...[0, 1, 2, 3].map((p) => port(`P${p + 1}`, p))));
      const percent = (v) => el('output', { textContent: `${Math.round(v * 100)}%` });
      children.push(row('Stick deadzone',
        button('−', 'pads.deadzone.down', edit((h) => app.pad_set_deadzone(h, pad.deadzone - 0.02))),
        percent(pad.deadzone),
        button('+', 'pads.deadzone.up', edit((h) => app.pad_set_deadzone(h, pad.deadzone + 0.02)))));
      children.push(row('Trigger click',
        button('−', 'pads.click.down', edit((h) => app.pad_set_trigger_click(h, pad.triggerClick - 0.05))),
        percent(pad.triggerClick),
        button('+', 'pads.click.up', edit((h) => app.pad_set_trigger_click(h, pad.triggerClick + 0.05)))));

      // Bindings list:
      const customProf = getCustomProfile(pad.id);
      const bindings = el('div', { className: 'pad-bindings' });
      if (customProf && Object.keys(customProf).length > 0) {
        for (const step of CALIBRATION_STEPS) {
          const bound = customProf[step.key];
          const isListening = singleListening && singleListening.padHandle === pad.handle && singleListening.targetKey === step.key;
          bindings.append(el('div', { className: 'pad-binding' },
            el('span', { className: 'glyph', textContent: step.glyph }),
            el('span', { className: `bound ${isListening ? 'waiting' : ''}`,
              textContent: isListening ? 'Press any button/direction…' : `${step.name}: ${formatInputSource(bound)}` }),
            button(isListening ? 'Waiting…' : 'Change', `pads.custom.bind.${step.key}`, () => {
              const rawGp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.id === pad.id);
              singleListening = { padHandle: pad.handle, padId: pad.id, targetKey: step.key, baselineAxes: rawGp ? [...rawGp.axes] : null };
              pads.onChange();
            })
          ));
        }
      } else {
        const family = labels.inputs[pad.family] ?? labels.inputs[labels.inputs.length - 1];
        for (let target = 1; target < labels.targets.length; target++) {
          const controls = pad.bindings.map((t, input) => (t === target ? family[input] : null)).filter(Boolean);
          const waiting = pad.listening === target;
          bindings.append(el('div', { className: 'pad-binding' },
            el('span', { className: 'glyph', textContent: TARGET_GLYPHS[target] ?? labels.targets[target] }),
            el('span', { className: `bound ${waiting ? 'waiting' : ''}`,
              textContent: waiting ? 'Press a control…' : controls.length ? controls.join(', ') : 'Unbound' }),
            button('Change', `pads.bind.${target}`, edit((h) => app.pad_listen(h, target)))));
        }
      }
      children.push(bindings);
      children.push(el('p', { className: 'pad-live', ariaLabel: 'Live input' }));
    }
  } else {
    // Keyboard controls tab
    const keyPlayer = Number(root.dataset.keyPlayer || 0);
    root.dataset.keyPlayer = String(keyPlayer);
    const pBtn = (label, pIdx) => button(label, `key.p.${pIdx}`, () => {
      root.dataset.keyPlayer = String(pIdx);
      keyListening = null;
      renderControllers(root, pads, labels, handle, { onDone });
    }, `pad-button ${keyPlayer === pIdx ? 'on' : ''}`);

    children.push(row('Player', pBtn('Player 1', 0), pBtn('Player 2', 1)));
    children.push(el('p', { className: 'pad-note', textContent: 'Remap keyboard keys for this player. Click Change and press any key to rebind (or Esc to cancel). Grab (Z) triggers Link\'s Hookshot & Samus\'s Grapple in mid-air. Settings persist automatically.' }));

    const bindings = el('div', { className: 'pad-bindings' });
    for (const def of KEYBOARD_ACTION_DEFS) {
      const code = currentKeyPrefs[keyPlayer]?.[def.action] ?? DEFAULT_KEYS[keyPlayer]?.[def.action];
      const isWaiting = keyListening && keyListening.player === keyPlayer && keyListening.action === def.action;
      bindings.append(el('div', { className: 'pad-binding' },
        el('span', { className: 'glyph', textContent: isWaiting ? '…' : formatKeyCode(code) }),
        el('span', { className: `bound ${isWaiting ? 'waiting' : ''}`,
          textContent: isWaiting ? 'Press any key…' : `${def.label} — ${def.note}` }),
        button(isWaiting ? 'Waiting…' : 'Change', `key.bind.${def.action}`, () => {
          keyListening = { player: keyPlayer, action: def.action };
          renderControllers(root, pads, labels, handle, { onDone });
        })
      ));
    }
    children.push(bindings);
    children.push(el('div', { style: 'margin: 0.5rem 0;' },
      button('Reset to defaults', 'key.reset', () => {
        resetKeyPrefs(keyPlayer);
        renderControllers(root, pads, labels, handle, { onDone });
      })
    ));
  }

  const done = button('Done', 'pads.done', onDone, 'btn accent');
  done.replaceChildren(el('span', { textContent: 'Done' }));
  children.push(el('div', { className: 'rules-buttons' }, done));
  root.replaceChildren(...children);
  root.dataset.handle = pad?.handle ?? '';
  updateLive(root, pad);
  const again = focused && root.querySelector(`[data-focus-id="${focused}"]`);
  (again || (root.contains(document.activeElement) ? null : root.querySelector('button')))?.focus({ preventScroll: true });
  return pad?.handle ?? null;
}

/** The live readout: sticks, triggers, held GameCube buttons, and raw hardware inputs. */
export function updateLive(root, pad) {
  const live = root.querySelector('.pad-live');
  if (!live || !pad) return;
  const held = LIVE_BUTTONS.filter((_, bit) => pad.buttons & (1 << bit));

  // Inspect raw gamepad to show live hardware activity
  let rawText = '';
  try {
    const rawGp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.id === pad.name);
    if (rawGp) {
      const pressedBtns = [];
      rawGp.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.4)) pressedBtns.push(`#${i}`); });
      const nonZeroAxes = [];
      rawGp.axes.forEach((v, i) => { if (Math.abs(v) > 0.15) nonZeroAxes.push(`Ax${i}:${v.toFixed(2)}`); });
      if (pressedBtns.length || nonZeroAxes.length) {
        rawText = `   [HW: ${pressedBtns.length ? `Btns ${pressedBtns.join(',')}` : ''}${pressedBtns.length && nonZeroAxes.length ? ' ' : ''}${nonZeroAxes.length ? nonZeroAxes.join(' ') : ''}]`;
      }
    }
  } catch {}

  const text = `Stick ${pad.stick[0]}, ${pad.stick[1]}   C ${pad.cstick[0]}, ${pad.cstick[1]}   `
    + `L ${pad.triggers[0]}  R ${pad.triggers[1]}   ${held.join(' ')}${rawText}`;
  if (live.textContent !== text) live.textContent = text;
}

// ---- ?pads=a,right,...: scripted pads for a pad-only walk.

/** Steps by position (as macOS's MELEE_APP_PADS): a b x y are the bottom, left, right and top face buttons. */
const STEP_BUTTONS = { a: 0, b: 2, x: 1, y: 3, z: 5, l: 6, r: 7, select: 8, start: 9, home: 16,
  up: 12, down: 13, left: 14, right: 15 };
const STEP_STICKS = { 'stick-up': [0, -1], 'stick-down': [0, 1], 'stick-left': [-1, 0], 'stick-right': [1, 0] };

/**
 * Two fake standard gamepads (a Switch Pro Controller and a DualSense).
 * Each step taps one control for one poll on pad 1 (`2:a` on pad 2);
 * `report(step)` runs after it. Returns null for an unknown step.
 */
export class FakePads {
  static ids = ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
    'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'];
  constructor() {
    this.pads = FakePads.ids.map((id, i) => ({ id, index: 100 + i, connected: true, mapping: 'standard',
      buttons: Array.from({ length: INPUTS }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }));
    this.release = [];
  }
  gamepads() { return this.pads; }
  static valid(step) {
    const name = step.replace(/^[12]:/, '');
    return name in STEP_BUTTONS || name in STEP_STICKS || /^wait(:[\d.]+)?$/.test(name);
  }
  tap(step) {
    const match = /^([12]):(.*)$/.exec(step);
    const pad = this.pads[match ? Number(match[1]) - 1 : 0];
    const name = match ? match[2] : step;
    if (name in STEP_BUTTONS) {
      const button = pad.buttons[STEP_BUTTONS[name]];
      Object.assign(button, { pressed: true, value: 1 });
      this.release.push(() => Object.assign(button, { pressed: false, value: 0 }));
    } else if (name in STEP_STICKS) {
      pad.axes = [...STEP_STICKS[name], 0, 0];
      this.release.push(() => { pad.axes = [0, 0, 0, 0]; });
    }
  }
  /** The tap lasts one poll. */
  afterPoll() {
    for (const release of this.release.splice(0)) release();
  }
  /** Run `steps` one per `interval` ms, calling report(step) just before the next. */
  run(steps, interval, report, done) {
    let at = 1000;
    for (const step of steps) {
      const wait = /^wait(?::([\d.]+))?$/.exec(step);
      if (wait) { at += wait[1] ? Number(wait[1]) * 1000 : interval; continue; }
      setTimeout(() => this.tap(step), at);
      setTimeout(() => report(step), at + interval * 0.9);
      at += interval;
    }
    setTimeout(done, at + 500);
  }
}
