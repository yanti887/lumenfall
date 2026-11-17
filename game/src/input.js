// Keyboard and pointer input for LUMENFALL. Held keys give a steering vector and a held
// fire; one-shot presses (start or restart, pause, mute, dash) are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost and never
// counted twice. The mouse aims the ship and fires while held; the right button dashes.
// `toField` converts a pointer position on the page into playfield coordinates.

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
  });

  target.addEventListener('pointermove', (event) => {
    const p = toField(event.clientX, event.clientY);
    aimX = p.x;
    aimY = p.y;
    hasMouse = true;
  });
  target.addEventListener('pointerdown', (event) => {
    const p = toField(event.clientX, event.clientY);
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
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) firing = false;
  });
  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  return {
    /** Normalised steering vector from the held movement keys. */
    move() {
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
  };
}
