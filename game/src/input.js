// Keyboard and pointer input for LUMENFALL. Held keys give a steering vector and a held
// fire; one-shot presses (start or restart, pause, mute, dash) are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost and never
// counted twice. The mouse aims the ship and fires while held; the right button dashes.
// `toField` converts a pointer position on the page into playfield coordinates.
//
// Touch controls: a floating analog stick on the left half (it appears where the finger
// lands; dragging it steers, the further the drag the faster) and a dash button at the
// bottom-right. A touch marks touch mode, so the game auto-fires and auto-aims at the
// nearest creature; a mouse marks mouse mode again. Any touch also confirms (start /
// restart / continue / resume), so tapping the title or game-over screen starts a run.

import { FIELD, MUTE_RECT } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_RESTART = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);
const RESTART = new Set(['KeyR']);
const DASH = new Set(['ShiftLeft', 'ShiftRight']);

/** The analog stick's travel radius, in field units. */
const JOY_RADIUS = 72;
/** The on-screen dash button, in field coordinates (bottom-right). */
const DASH_BUTTON = { x: 1180, y: 614, r: 54 };

const HAS_TOUCH = 'ontouchstart' in window || (window.navigator && window.navigator.maxTouchPoints > 0);

export function createInput(target, toField) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let firing = false;
  let dashQueued = false;
  let actions = 0;
  let aimX = 640;
  let aimY = 240;
  let hasMouse = false;
  let clicks = [];
  let touchMode = false;
  let dashPressed = false;
  const joy = { active: false, id: null, baseX: 0, baseY: 0, knobX: 0, knobY: 0, dx: 0, dy: 0 };

  function key(code, isDown) {
    if (UP.has(code)) up = isDown;
    else if (DOWN.has(code)) down = isDown;
    else if (LEFT.has(code)) left = isDown;
    else if (RIGHT.has(code)) right = isDown;
  }

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) {
      key(event.code, true);
      event.preventDefault();
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (DASH.has(event.code)) {
      if (!event.repeat) dashQueued = true;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    key(event.code, false);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    up = false; down = false; left = false; right = false; firing = false;
    joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
    dashPressed = false;
  });

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function inMute(p) {
    return p.x >= MUTE_RECT.x && p.x <= MUTE_RECT.x + MUTE_RECT.w
      && p.y >= MUTE_RECT.y && p.y <= MUTE_RECT.y + MUTE_RECT.h;
  }
  function inDash(p) {
    const dx = p.x - DASH_BUTTON.x;
    const dy = p.y - DASH_BUTTON.y;
    return dx * dx + dy * dy <= DASH_BUTTON.r * DASH_BUTTON.r;
  }

  target.addEventListener('pointerdown', (event) => {
    const p = toField(event.clientX, event.clientY);
    if (event.pointerType === 'touch') {
      touchMode = true;
      if (inMute(p)) {
        clicks.push({ x: p.x, y: p.y, button: 0 });
        event.preventDefault();
        return;
      }
      // Any touch confirms (start / restart / continue / resume).
      actions |= ACTION_CONFIRM;
      if (inDash(p)) {
        dashQueued = true;
        dashPressed = true;
        event.preventDefault();
        return;
      }
      if (p.x < FIELD.width / 2 && !joy.active) {
        // Keep the stick inside the playfield, even when the finger lands in the
        // letterbox around it (a portrait phone shows the field small and centred).
        joy.active = true;
        joy.id = event.pointerId;
        joy.baseX = clamp(p.x, 0, FIELD.width);
        joy.baseY = clamp(p.y, 0, FIELD.height);
        joy.knobX = joy.baseX; joy.knobY = joy.baseY;
        joy.dx = 0; joy.dy = 0;
      }
      event.preventDefault();
      return;
    }
    // Mouse / pen.
    touchMode = false;
    aimX = p.x;
    aimY = p.y;
    hasMouse = true;
    clicks.push({ x: p.x, y: p.y, button: event.button });
    if (event.button === 0) {
      firing = true;
      actions |= ACTION_CONFIRM;
    } else if (event.button === 2) {
      dashQueued = true;
    }
    event.preventDefault();
  });
  target.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') {
      if (joy.active && event.pointerId === joy.id) {
        const p = toField(event.clientX, event.clientY);
        let dx = p.x - joy.baseX;
        let dy = p.y - joy.baseY;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) {
          dx = (dx / len) * JOY_RADIUS;
          dy = (dy / len) * JOY_RADIUS;
        }
        joy.knobX = joy.baseX + dx;
        joy.knobY = joy.baseY + dy;
        joy.dx = dx / JOY_RADIUS;
        joy.dy = dy / JOY_RADIUS;
      }
      event.preventDefault();
      return;
    }
    const p = toField(event.clientX, event.clientY);
    aimX = p.x;
    aimY = p.y;
    hasMouse = true;
    touchMode = false;
  });
  function releaseTouch(event) {
    if (joy.active && event.pointerId === joy.id) {
      joy.active = false;
      joy.id = null;
      joy.dx = 0;
      joy.dy = 0;
    }
    dashPressed = false;
  }
  window.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') {
      releaseTouch(event);
      return;
    }
    if (event.button === 0) firing = false;
  });
  window.addEventListener('pointercancel', (event) => {
    if (event.pointerType === 'touch') releaseTouch(event);
  });
  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  return {
    /** Normalised steering vector: the analog stick when it is held, else the held movement keys. */
    move() {
      if (joy.active) return { x: joy.dx, y: joy.dy };
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const y = (down ? 1 : 0) - (up ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    },
    aim() {
      return { x: aimX, y: aimY, hasMouse };
    },
    firing() {
      return firing;
    },
    /** True once when a dash was queued since the last call. */
    takeDash() {
      const queued = dashQueued;
      dashQueued = false;
      return queued;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Pointer presses since the last call, as { x, y, button } in field coordinates. */
    takeClicks() {
      const taken = clicks;
      clicks = [];
      return taken;
    },
    /** True once a touch has been used (and no mouse since): the game auto-fires and auto-aims. */
    isTouchMode() {
      return touchMode;
    },
    /** Touch control state for the renderer: the stick, the dash button, and whether to show them. */
    touch() {
      return {
        hasTouch: HAS_TOUCH,
        touchMode,
        dashButton: DASH_BUTTON,
        dashPressed,
        joystick: joy.active
          ? { baseX: joy.baseX, baseY: joy.baseY, knobX: joy.knobX, knobY: joy.knobY }
          : null,
      };
    },
  };
}
