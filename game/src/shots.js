// The screenshot scenes behind ?shot=start|play|win|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot,
// so the frame is what a short game really looks like and the same seed always gives the
// same frame. The win scene sets up the last wave with one creature left and lets the
// pilot finish it, so the victory screen is reached by playing, not by fiat.

import { FIELD, STEP } from './config.js';
import { EVENT_OVER, EVENT_WIN, KIND_WISP } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const START_SECONDS = 5;
/** The play scene runs a fixed 88 seconds: by then the pilot is deep in wave 6 with a
 * x5 combo and several creatures on screen, a busy mid-game frame. */
const PLAY_SECONDS = 88;
const LIMIT_SECONDS = 600;
const SAMPLE_HZ = 60;

function nearestEnemy(state) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return { enemy: best, dist: bestD };
}

function clampMove(x, y) {
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

/** The title screen's backdrop: the ship drifts in a slow circle and shoots at wisps. */
export function ambientPilot(state) {
  const p = state.player;
  const t = state.time;
  const cx = FIELD.width / 2 + Math.cos(t * 0.35) * 230;
  const cy = FIELD.height / 2 + 40 + Math.sin(t * 0.35) * 150;
  const move = clampMove((cx - p.x) / 220, (cy - p.y) / 220);
  const near = nearestEnemy(state);
  let aimX = p.x;
  let aimY = p.y - 200;
  if (near.enemy !== null) {
    aimX = near.enemy.x;
    aimY = near.enemy.y;
  }
  return { mx: move.x, my: move.y, aimX, aimY, fire: near.enemy !== null, dash: false, hasMouse: true };
}

/** A competent pilot: it kites — repulsion from every close creature wins over chasing —
 * leads the nearest target, grabs a heart when hurt, chases close shards when it is safe,
 * and dashes out when it is surrounded. */
export function combatPilot(state) {
  const p = state.player;
  const near = nearestEnemy(state);
  let aimX = p.x + Math.cos(p.angle) * 200;
  let aimY = p.y + Math.sin(p.angle) * 200;
  if (near.enemy !== null) {
    const lead = near.dist / 780;
    aimX = near.enemy.x + near.enemy.vx * lead;
    aimY = near.enemy.y + near.enemy.vy * lead;
  }
  // Repulsion from every close creature, weighted by closeness.
  let rx = 0;
  let ry = 0;
  let closeCount = 0;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 280) {
      const w = (280 - d) / 280;
      rx += (dx / d) * w;
      ry += (dy / d) * w;
      if (d < 140) closeCount += 1;
    }
  }
  let mx = 0;
  let my = 0;
  const repLen = Math.hypot(rx, ry);
  // A heart is worth a detour while hurt.
  let heart = null;
  let hd = 420;
  if (p.hp < 3) {
    for (const pk of state.pickups) {
      if (!pk.active || pk.kind !== 0) continue;
      const dd = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (dd < hd) {
        hd = dd;
        heart = pk;
      }
    }
  }
  if (heart !== null && closeCount === 0) {
    mx = (heart.x - p.x) / hd;
    my = (heart.y - p.y) / hd;
  } else if (repLen > 0.25) {
    mx = rx / repLen;
    my = ry / repLen;
  } else if (near.enemy !== null && near.dist > 300) {
    mx = (near.enemy.x - p.x) / near.dist;
    my = (near.enemy.y - p.y) / near.dist;
  } else {
    // Safe and in range: drift toward the nearest shard, else hold a slow orbit.
    let shard = null;
    let sd = 300;
    for (const s of state.shards) {
      if (!s.active) continue;
      const dd = Math.hypot(s.x - p.x, s.y - p.y);
      if (dd < sd) {
        sd = dd;
        shard = s;
      }
    }
    if (shard !== null) {
      mx = (shard.x - p.x) / sd;
      my = (shard.y - p.y) / sd;
    } else if (near.enemy !== null) {
      const dx = p.x - near.enemy.x;
      const dy = p.y - near.enemy.y;
      const d = near.dist || 1;
      mx = (-dy / d) * 0.6;
      my = (dx / d) * 0.6;
    } else {
      const move = clampMove((FIELD.width / 2 - p.x) / 300, (FIELD.height / 2 - p.y) / 300);
      mx = move.x;
      my = move.y;
    }
  }
  const move = clampMove(mx, my);
  const dash = (closeCount >= 2 || (near.enemy !== null && near.dist < 70)) && p.dashCd <= 0;
  return { mx: move.x, my: move.y, aimX, aimY, fire: near.enemy !== null, dash, hasMouse: true };
}

/** A careless pilot: it walks toward the nearest creature, never fires, never dashes. */
export function carelessPilot(state) {
  const p = state.player;
  const near = nearestEnemy(state);
  let mx = 0;
  let my = 0;
  if (near.enemy !== null) {
    const d = near.dist || 1;
    mx = ((near.enemy.x - p.x) / d) * 0.6;
    my = ((near.enemy.y - p.y) / d) * 0.6;
  } else {
    const move = clampMove((FIELD.width / 2 - p.x) / 300, (FIELD.height / 2 - p.y) / 300);
    mx = move.x;
    my = move.y;
  }
  const aimX = near.enemy !== null ? near.enemy.x : p.x;
  const aimY = near.enemy !== null ? near.enemy.y : p.y - 100;
  return { mx, my, aimX, aimY, fire: false, dash: false, hasMouse: true };
}

/**
 * Set `world` to the named scene (start, play, win or end; any other name is start) and
 * return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    let over = false;
    for (let index = 0; index < PLAY_SECONDS * SAMPLE_HZ; index += 1) {
      const events = world.step(STEP, combatPilot(world.state), false);
      if (events & EVENT_OVER) {
        over = true;
        break;
      }
    }
    return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
  }
  if (name === 'win') {
    const s = world.state;
    s.score = 11800;
    s.combo = 12;
    s.mult = 3;
    s.comboTimer = 2.5;
    s.wave = 10;
    s.waveState = 'active';
    s.spawnQueue = [KIND_WISP];
    s.spawnTimer = 0.2;
    s.coreGlow = 0.9;
    let won = false;
    for (let index = 0; index < 40 * SAMPLE_HZ; index += 1) {
      const events = world.step(STEP, combatPilot(world.state), false);
      if (events & EVENT_WIN) {
        won = true;
        break;
      }
      if (events & EVENT_OVER) break;
    }
    if (!won) {
      s.waveState = 'won';
      s.won = true;
    }
    for (let index = 0; index < 120; index += 1) {
      world.step(STEP, { mx: 0, my: 0, aimX: s.player.x, aimY: s.player.y - 100, fire: false, dash: false, hasMouse: false }, true);
    }
    return { screen: SCREEN_WIN, best: world.state.score };
  }
  if (name === 'end') {
    let over = false;
    for (let index = 0; index < LIMIT_SECONDS * SAMPLE_HZ; index += 1) {
      const events = world.step(STEP, carelessPilot(world.state), false);
      if (events & EVENT_OVER) {
        over = true;
        break;
      }
    }
    return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
  }
  for (let index = 0; index < START_SECONDS * SAMPLE_HZ; index += 1) {
    world.step(STEP, ambientPilot(world.state), true);
  }
  return { screen: SCREEN_TITLE, best: 0 };
}
