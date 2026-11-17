// LUMENFALL — the game's rules and state, with no drawing and no browser in it: the
// player ship, bullets, three enemy kinds, shards, pickups, particles and floating score
// text, waves, combo multiplier and the win/lose conditions. step() advances one fixed
// step and returns what happened as bit flags, so the caller can react (and play sounds)
// without the world knowing about screens or audio. Nothing here allocates after
// createWorld returns; every list is a fixed pool.

import { ENEMY, FIELD, PICKUP, PLAYER, POOL, SHARD, WAVE, WIN_WAVE } from './config.js';

export const KIND_WISP = 0;
export const KIND_DARTER = 1;
export const KIND_BULWARK = 2;

export const EVENT_HIT = 1;
export const EVENT_KILL = 2;
export const EVENT_SHARD = 4;
export const EVENT_OVER = 8;
export const EVENT_WIN = 16;
export const EVENT_WAVE = 32;
export const EVENT_PICKUP = 64;
export const EVENT_DASH = 128;
export const EVENT_FIRE = 256;

const TAU = Math.PI * 2;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** The wave's roster: wisps from the start, darters from wave 2, bulwarks from wave 3. */
export function waveComp(wave, random) {
  const list = [];
  const wisps = Math.min(3 + wave * 2, 18);
  const darters = wave >= 2 ? Math.min(1 + wave, 10) : 0;
  const bulwarks = wave >= 3 ? Math.min(1 + Math.floor((wave - 2) / 2), 5) : 0;
  for (let i = 0; i < wisps; i += 1) list.push(KIND_WISP);
  for (let i = 0; i < darters; i += 1) list.push(KIND_DARTER);
  for (let i = 0; i < bulwarks; i += 1) list.push(KIND_BULWARK);
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

export function createWorld(random) {
  const player = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: PLAYER.hp,
    fireTimer: 0, dashTimer: 0, dashCd: 0, invuln: 0,
    over: false, overTimer: 0, alive: true, flame: 0,
  };
  const bullets = [];
  for (let i = 0; i < POOL.bullets; i += 1) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const enemies = [];
  for (let i = 0; i < POOL.enemies; i += 1) {
    enemies.push({ active: false, kind: KIND_WISP, x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, r: 13, state: 0, stateTimer: 0, tx: 0, ty: 0, flash: 0, spawnT: 0, wobble: 0 });
  }
  const shards = [];
  for (let i = 0; i < POOL.shards; i += 1) shards.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, value: SHARD.value, life: 0, spin: 0 });
  const pickups = [];
  for (let i = 0; i < POOL.pickups; i += 1) pickups.push({ active: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const particles = [];
  for (let i = 0; i < POOL.particles; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#fff', drag: 0 });
  const floaters = [];
  for (let i = 0; i < POOL.floaters; i += 1) floaters.push({ active: false, x: 0, y: 0, text: '', life: 0, maxLife: 1, color: '#fff', size: 18 });
  const stars = [];
  for (let i = 0; i < 110; i += 1) {
    stars.push({ x: random() * FIELD.width, y: random() * FIELD.height, r: 0.6 + random() * 1.7, phase: random() * TAU, speed: 0.5 + random() * 2.2 });
  }

  const state = {
    player, bullets, enemies, shards, pickups, particles, floaters, stars,
    score: 0, combo: 0, comboTimer: 0, mult: 1, kills: 0,
    wave: 1, waveState: 'intro', spawnQueue: [], spawnTimer: 0, interTimer: WAVE.intermission,
    time: 0, shake: 0, flash: 0, coreGlow: 0.15, endless: false, won: false,
    ambientTimer: 1.2, hintTimer: 7,
  };

  function free(list) {
    for (let i = 0; i < list.length; i += 1) if (!list[i].active) return list[i];
    return null;
  }

  function burst(x, y, color, count, speed, life, size) {
    for (let i = 0; i < count; i += 1) {
      const p = free(particles);
      if (p === null) return;
      const a = random() * TAU;
      const s = speed * (0.3 + random() * 0.9);
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.life = p.maxLife = life * (0.5 + random() * 0.8);
      p.size = size * (0.6 + random() * 0.8);
      p.color = color;
      p.drag = 3.2;
    }
  }

  function floater(x, y, text, color, size) {
    const f = free(floaters);
    if (f === null) return;
    f.active = true;
    f.x = x; f.y = y;
    f.text = text;
    f.life = f.maxLife = 0.9;
    f.color = color;
    f.size = size || 18;
  }

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2 + 60;
    player.vx = 0; player.vy = 0; player.angle = -Math.PI / 2;
    player.hp = PLAYER.hp; player.fireTimer = 0; player.dashTimer = 0; player.dashCd = 0;
    player.invuln = 0; player.over = false; player.overTimer = 0; player.alive = true;
    for (const b of bullets) b.active = false;
    for (const e of enemies) e.active = false;
    for (const s of shards) s.active = false;
    for (const p of pickups) p.active = false;
    for (const p of particles) p.active = false;
    for (const f of floaters) f.active = false;
    state.score = 0; state.combo = 0; state.comboTimer = 0; state.mult = 1; state.kills = 0;
    state.wave = 1; state.waveState = 'intro'; state.spawnQueue = [];
    state.spawnTimer = 0; state.interTimer = WAVE.intermission;
    state.time = 0; state.shake = 0; state.flash = 0; state.coreGlow = 0.15;
    state.endless = false; state.won = false; state.ambientTimer = 1.2; state.hintTimer = 7;
  }

  function spawnEnemy(kind) {
    const e = free(enemies);
    if (e === null) return;
    const def = kind === KIND_WISP ? ENEMY.wisp : kind === KIND_DARTER ? ENEMY.darter : ENEMY.bulwark;
    const edge = Math.floor(random() * 4);
    if (edge === 0) { e.x = random() * FIELD.width; e.y = -40; }
    else if (edge === 1) { e.x = random() * FIELD.width; e.y = FIELD.height + 40; }
    else if (edge === 2) { e.x = -40; e.y = random() * FIELD.height; }
    else { e.x = FIELD.width + 40; e.y = random() * FIELD.height; }
    e.active = true;
    e.kind = kind;
    e.hp = e.maxHp = def.hp;
    e.r = def.radius;
    e.vx = 0; e.vy = 0;
    e.state = 0; e.stateTimer = 0;
    e.flash = 0; e.spawnT = 0.35; e.wobble = random() * TAU;
    burst(e.x, clamp(e.y, 10, FIELD.height - 10), '#8b93ff', 8, 120, 0.4, 2.5);
  }

  function spawnShards(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const s = free(shards);
      if (s === null) return;
      const a = random() * TAU;
      const sp = 60 + random() * 140;
      s.active = true;
      s.x = x; s.y = y;
      s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
      s.value = SHARD.value;
      s.life = 9;
      s.spin = random() * TAU;
    }
  }

  function dropPickup(x, y) {
    const roll = random();
    const kind = roll < PICKUP.heartChance ? 0 : roll < PICKUP.heartChance + PICKUP.overChance ? 1 : -1;
    if (kind < 0) return;
    const p = free(pickups);
    if (p === null) return;
    const a = random() * TAU;
    p.active = true;
    p.kind = kind;
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * 70; p.vy = Math.sin(a) * 70;
    p.life = 10;
  }

  function killEnemy(e, events) {
    const def = e.kind === KIND_WISP ? ENEMY.wisp : e.kind === KIND_DARTER ? ENEMY.darter : ENEMY.bulwark;
    const gained = def.score * state.mult;
    state.score += gained;
    state.kills += 1;
    floater(e.x, e.y - e.r - 6, '+' + gained, '#ffd76a', e.kind === KIND_BULWARK ? 24 : 18);
    const color = e.kind === KIND_WISP ? '#ff5da2' : e.kind === KIND_DARTER ? '#39d5ff' : '#ff8a3d';
    burst(e.x, e.y, color, e.kind === KIND_BULWARK ? 26 : 14, e.kind === KIND_BULWARK ? 320 : 240, 0.6, 3.5);
    burst(e.x, e.y, '#ffffff', 6, 160, 0.35, 2);
    spawnShards(e.x, e.y, def.shards);
    if (e.kind === KIND_BULWARK) {
      dropPickup(e.x, e.y);
      for (let i = 0; i < 2; i += 1) {
        const w = free(enemies);
        if (w === null) break;
        const d = ENEMY.wisp;
        w.active = true; w.kind = KIND_WISP;
        w.hp = w.maxHp = d.hp; w.r = d.radius;
        w.x = e.x + (i === 0 ? -24 : 24); w.y = e.y;
        w.vx = 0; w.vy = 0; w.state = 0; w.stateTimer = 0;
        w.flash = 0; w.spawnT = 0.2; w.wobble = random() * TAU;
      }
    } else if (e.kind === KIND_DARTER && random() < 0.06) {
      dropPickup(e.x, e.y);
    }
    e.active = false;
    return events | EVENT_KILL;
  }

  function damagePlayer(events) {
    if (player.invuln > 0 || player.dashTimer > 0 || !player.alive) return events;
    player.hp -= 1;
    player.invuln = PLAYER.invulnerable;
    state.shake = 16;
    state.flash = 0.55;
    state.combo = 0; state.comboTimer = 0; state.mult = 1;
    burst(player.x, player.y, '#ff5d6c', 22, 300, 0.6, 3.5);
    events |= EVENT_HIT;
    if (player.hp <= 0) {
      player.alive = false;
      burst(player.x, player.y, '#ffd76a', 40, 380, 1.0, 4);
      burst(player.x, player.y, '#ff5d6c', 30, 300, 0.9, 3.5);
      state.shake = 22;
      events |= EVENT_OVER;
    }
    return events;
  }

  function fireBullet(angle) {
    const b = free(bullets);
    if (b === null) return;
    const nose = PLAYER.radius + 8;
    b.active = true;
    b.x = player.x + Math.cos(angle) * nose;
    b.y = player.y + Math.sin(angle) * nose;
    b.vx = Math.cos(angle) * PLAYER.bulletSpeed;
    b.vy = Math.sin(angle) * PLAYER.bulletSpeed;
    b.life = PLAYER.bulletLife;
  }

  function beginWave() {
    state.spawnQueue = waveComp(state.wave, random);
    state.spawnTimer = 0.4;
    state.waveState = 'active';
  }

  function waveCleared(events) {
    const bonus = WAVE.clearBonus * state.wave;
    state.score += bonus;
    floater(FIELD.width / 2, FIELD.height / 2 - 90, 'WAVE ' + state.wave + ' CLEAR  +' + bonus, '#ffd76a', 30);
    burst(FIELD.width / 2, FIELD.height / 2, '#ffd76a', 40, 260, 0.9, 3);
    if (player.hp < PLAYER.maxHp) {
      player.hp += 1;
      floater(FIELD.width / 2, FIELD.height / 2 - 52, '+1 HULL', '#ff5d6c', 22);
    }
    state.coreGlow = Math.min(1, 0.15 + (state.wave / WIN_WAVE) * 0.85);
    events |= EVENT_WAVE;
    if (state.wave >= WIN_WAVE && !state.endless) {
      state.waveState = 'won';
      state.won = true;
      events |= EVENT_WIN;
      return events;
    }
    state.wave += 1;
    state.waveState = 'intro';
    state.interTimer = WAVE.intermission;
    return events;
  }

  function continueEndless() {
    state.endless = true;
    state.won = false;
    state.wave += 1;
    state.waveState = 'intro';
    state.interTimer = WAVE.intermission;
  }

  function countAlive(list) {
    let n = 0;
    for (const item of list) if (item.active) n += 1;
    return n;
  }

  /**
   * One fixed step. `input` is { mx, my, aimX, aimY, fire, dash, hasMouse }.
   * With `harmless` set (the title screen's backdrop) things drift and the ship can
   * shoot, but nothing hurts the player and nothing scores or advances waves.
   */
  function step(dt, input, harmless) {
    let events = 0;
    state.time += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 34);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.8);
    if (state.hintTimer > 0) state.hintTimer -= dt;

    // Combo decay.
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) {
        state.combo = 0;
        state.mult = 1;
      }
    }

    // --- Player ---
    if (player.alive) {
      const dashing = player.dashTimer > 0;
      if (player.dashTimer > 0) player.dashTimer -= dt;
      if (player.dashCd > 0) player.dashCd -= dt;
      if (player.invuln > 0) player.invuln -= dt;
      if (player.overTimer > 0) {
        player.overTimer -= dt;
        if (player.overTimer <= 0) player.over = false;
      }
      if (input.dash && player.dashCd <= 0 && !dashing) {
        const dx = input.mx !== 0 || input.my !== 0 ? input.mx : Math.cos(player.angle);
        const dy = input.mx !== 0 || input.my !== 0 ? input.my : Math.sin(player.angle);
        const len = Math.hypot(dx, dy) || 1;
        player.vx = (dx / len) * PLAYER.dashSpeed;
        player.vy = (dy / len) * PLAYER.dashSpeed;
        player.dashTimer = PLAYER.dashTime;
        player.dashCd = PLAYER.dashCooldown;
        player.invuln = Math.max(player.invuln, PLAYER.dashTime + 0.08);
        burst(player.x, player.y, '#39d5ff', 12, 200, 0.4, 3);
        events |= EVENT_DASH;
      }
      if (!dashing) {
        player.vx += input.mx * PLAYER.accel * dt;
        player.vy += input.my * PLAYER.accel * dt;
        const damp = Math.max(0, 1 - PLAYER.drag * dt);
        player.vx *= damp;
        player.vy *= damp;
        const speed = Math.hypot(player.vx, player.vy);
        if (speed > PLAYER.speed) {
          player.vx = (player.vx / speed) * PLAYER.speed;
          player.vy = (player.vy / speed) * PLAYER.speed;
        }
      }
      player.x = clamp(player.x + player.vx * dt, PLAYER.radius, FIELD.width - PLAYER.radius);
      player.y = clamp(player.y + player.vy * dt, PLAYER.radius, FIELD.height - PLAYER.radius);
      if (player.x <= PLAYER.radius || player.x >= FIELD.width - PLAYER.radius) player.vx = 0;
      if (player.y <= PLAYER.radius || player.y >= FIELD.height - PLAYER.radius) player.vy = 0;
      player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);
      player.flame = 0.6 + random() * 0.7;

      // Engine trail.
      if (Math.hypot(player.vx, player.vy) > 60) {
        const p = free(particles);
        if (p !== null) {
          p.active = true;
          p.x = player.x - Math.cos(player.angle) * (PLAYER.radius + 2) + (random() - 0.5) * 6;
          p.y = player.y - Math.sin(player.angle) * (PLAYER.radius + 2) + (random() - 0.5) * 6;
          p.vx = -player.vx * 0.25 + (random() - 0.5) * 40;
          p.vy = -player.vy * 0.25 + (random() - 0.5) * 40;
          p.life = p.maxLife = 0.28;
          p.size = 2.6;
          p.color = player.over ? '#39d5ff' : '#ffb347';
          p.drag = 2;
        }
      }

      // Firing.
      player.fireTimer -= dt;
      if (input.fire && player.fireTimer <= 0) {
        player.fireTimer = player.over ? PLAYER.overInterval : PLAYER.fireInterval;
        if (player.over) {
          fireBullet(player.angle - 0.13);
          fireBullet(player.angle);
          fireBullet(player.angle + 0.13);
        } else {
          fireBullet(player.angle);
        }
        events |= EVENT_FIRE;
      }
    }

    // --- Waves ---
    if (!harmless && player.alive) {
      if (state.waveState === 'intro') {
        state.interTimer -= dt;
        if (state.interTimer <= 0) beginWave();
      } else if (state.waveState === 'active') {
        const alive = countAlive(enemies);
        if (state.spawnQueue.length > 0) {
          state.spawnTimer -= dt;
          const interval = Math.max(0.34, 0.95 - state.wave * 0.05);
          if (state.spawnTimer <= 0 && alive < WAVE.maxAlive) {
            spawnEnemy(state.spawnQueue.pop());
            state.spawnTimer = interval;
          }
        } else if (alive === 0) {
          events = waveCleared(events);
        }
      }
    } else if (harmless) {
      state.ambientTimer -= dt;
      if (state.ambientTimer <= 0 && countAlive(enemies) < 6) {
        spawnEnemy(KIND_WISP);
        state.ambientTimer = 1.4;
      }
    }

    // --- Bullets ---
    for (const b of bullets) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        b.active = false;
        continue;
      }
      for (const e of enemies) {
        if (!e.active || e.spawnT > 0) continue;
        const rr = e.r + PLAYER.bulletRadius;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          b.active = false;
          e.hp -= 1;
          e.flash = 0.09;
          burst(b.x, b.y, '#ffe9a3', 4, 140, 0.25, 2);
          if (e.hp <= 0) events = killEnemy(e, events);
          break;
        }
      }
    }

    // --- Enemies ---
    for (const e of enemies) {
      if (!e.active) continue;
      if (e.spawnT > 0) e.spawnT -= dt;
      if (e.flash > 0) e.flash -= dt;
      const def = e.kind === KIND_WISP ? ENEMY.wisp : e.kind === KIND_DARTER ? ENEMY.darter : ENEMY.bulwark;
      const speed = def.speed + def.speedPerWave * (state.wave - 1);
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      if (e.kind === KIND_WISP) {
        e.wobble += dt * 3;
        const px = -ny * Math.sin(e.wobble) * 0.5;
        const py = nx * Math.sin(e.wobble) * 0.5;
        e.vx += (nx * speed * 2.4 + px * speed - e.vx) * Math.min(1, dt * 3);
        e.vy += (ny * speed * 2.4 + py * speed - e.vy) * Math.min(1, dt * 3);
      } else if (e.kind === KIND_DARTER) {
        if (e.state === 0) {
          e.vx += (nx * speed * 2.2 - e.vx) * Math.min(1, dt * 3);
          e.vy += (ny * speed * 2.2 - e.vy) * Math.min(1, dt * 3);
          if (d < 280 && player.alive) {
            e.state = 1;
            e.stateTimer = def.telegraph;
          }
        } else if (e.state === 1) {
          e.vx *= Math.max(0, 1 - dt * 6);
          e.vy *= Math.max(0, 1 - dt * 6);
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            e.tx = nx; e.ty = ny;
            e.vx = nx * def.lungeSpeed;
            e.vy = ny * def.lungeSpeed;
            e.state = 2;
            e.stateTimer = 0.42;
          }
        } else if (e.state === 2) {
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            e.state = 3;
            e.stateTimer = 0.55;
          }
        } else {
          e.vx *= Math.max(0, 1 - dt * 4);
          e.vy *= Math.max(0, 1 - dt * 4);
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) e.state = 0;
        }
      } else {
        e.vx += (nx * speed * 2.2 - e.vx) * Math.min(1, dt * 2);
        e.vy += (ny * speed * 2.2 - e.vy) * Math.min(1, dt * 2);
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.x = clamp(e.x, -60, FIELD.width + 60);
      e.y = clamp(e.y, -60, FIELD.height + 60);

      // Touching the player hurts (unless harmless, dashing or invulnerable).
      if (!harmless && player.alive && e.spawnT <= 0) {
        const rr = e.r + PLAYER.radius - 2;
        if (dist2(e.x, e.y, player.x, player.y) < rr * rr) {
          if (player.dashTimer > 0) {
            e.hp -= 2;
            e.flash = 0.09;
            burst(e.x, e.y, '#39d5ff', 8, 220, 0.35, 2.5);
            if (e.hp <= 0) events = killEnemy(e, events);
          } else if (player.invuln <= 0) {
            const before = player.hp;
            events = damagePlayer(events);
            if (player.hp < before) {
              player.vx = -nx * 420;
              player.vy = -ny * 420;
              if (e.kind === KIND_WISP) {
                e.hp -= 1;
                if (e.hp <= 0) events = killEnemy(e, events);
              } else {
                e.vx = nx * 260;
                e.vy = ny * 260;
              }
            }
          }
        }
      }
    }

    // --- Shards ---
    for (const s of shards) {
      if (!s.active) continue;
      s.life -= dt;
      s.spin += dt * 5;
      if (s.life <= 0) { s.active = false; continue; }
      const d2 = dist2(s.x, s.y, player.x, player.y);
      if (player.alive && d2 < SHARD.magnetRadius * SHARD.magnetRadius) {
        const d = Math.sqrt(d2) || 1;
        const pull = 900 * (1 - d / (SHARD.magnetRadius * 1.4));
        s.vx += ((player.x - s.x) / d) * pull * dt * 4;
        s.vy += ((player.y - s.y) / d) * pull * dt * 4;
      }
      s.vx *= Math.max(0, 1 - dt * 2.4);
      s.vy *= Math.max(0, 1 - dt * 2.4);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (player.alive && d2 < SHARD.collectRadius * SHARD.collectRadius) {
        s.active = false;
        if (!harmless) {
          const gained = s.value * state.mult;
          state.score += gained;
          state.combo += 1;
          state.comboTimer = SHARD.comboWindow;
          state.mult = Math.min(SHARD.maxMult, 1 + Math.floor(state.combo / SHARD.comboPerMult));
          floater(s.x, s.y - 10, '+' + gained, '#ffe9a3', 15);
          events |= EVENT_SHARD;
        }
      }
    }

    // --- Pickups ---
    for (const p of pickups) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vx *= Math.max(0, 1 - dt * 2);
      p.vy *= Math.max(0, 1 - dt * 2);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (player.alive && dist2(p.x, p.y, player.x, player.y) < 34 * 34) {
        p.active = false;
        if (!harmless) {
          if (p.kind === 0) {
            if (player.hp < PLAYER.maxHp) {
              player.hp += 1;
              floater(player.x, player.y - 30, '+1 HULL', '#ff5d6c', 20);
            } else {
              state.score += PICKUP.heartScore;
              floater(player.x, player.y - 30, '+' + PICKUP.heartScore, '#ff5d6c', 20);
            }
          } else {
            player.over = true;
            player.overTimer = PICKUP.overTime;
            floater(player.x, player.y - 30, 'OVERCHARGE!', '#39d5ff', 22);
          }
          events |= EVENT_PICKUP;
        }
      }
    }

    // --- Particles ---
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // --- Floaters ---
    for (const f of floaters) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) { f.active = false; continue; }
      f.y -= 34 * dt;
    }

    return events;
  }

  reset();
  return { state, reset, step, continueEndless };
}
