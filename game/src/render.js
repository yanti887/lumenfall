// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Canvas shapes and gradients only — every sprite is drawn in code, so the game
// needs no image files at all. Text that holds a number is rebuilt only when the number
// changes, so a frame allocates nothing.

import { FIELD, FONT, MUTE_RECT, PALETTE, PLAYER, WAVE } from './config.js';
import { KIND_BULWARK, KIND_DARTER, KIND_WISP } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const TAU = Math.PI * 2;

/** Nebula blobs, fixed in field coordinates: soft colour washes behind the action. */
const NEBULAE = [
  { x: 240, y: 170, r: 320, color: 'rgba(64, 80, 180, 0.20)' },
  { x: 1060, y: 540, r: 360, color: 'rgba(160, 50, 120, 0.16)' },
  { x: 980, y: 130, r: 260, color: 'rgba(40, 140, 160, 0.14)' },
  { x: 300, y: 600, r: 280, color: 'rgba(90, 60, 170, 0.14)' },
];

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

function heartPath(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.9);
  ctx.bezierCurveTo(x - size * 1.2, y + size * 0.1, x - size * 0.7, y - size * 0.9, x, y - size * 0.25);
  ctx.bezierCurveTo(x + size * 0.7, y - size * 0.9, x + size * 1.2, y + size * 0.1, x, y + size * 0.9);
  ctx.closePath();
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('SCORE ');
  const waveLabel = cachedLabel('WAVE ');
  const finalLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const multLabel = cachedLabel('x');
  const leftLabel = cachedLabel('VOID LEFT: ');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** Page coordinates (a pointer event) into playfield coordinates. */
  function toField(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const px = (clientX - rect.left) * ratio;
    const py = (clientY - rect.top) * ratio;
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight) {
    const key = size + (weight || '');
    if (!fonts.has(key)) fonts.set(key, `${weight ? weight + ' ' : ''}${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function drawBackground(state) {
    const grad = context.createLinearGradient(0, 0, 0, FIELD.height);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(1, PALETTE.skyBottom);
    context.fillStyle = grad;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    for (const n of NEBULAE) {
      const g = context.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, n.color);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = g;
      context.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    // The dying star at the centre: it brightens as waves are cleared.
    const cx = FIELD.width / 2;
    const cy = FIELD.height / 2;
    const pulse = 0.85 + 0.15 * Math.sin(state.time * 1.4);
    const glowR = 150 + state.coreGlow * 160;
    const core = context.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    core.addColorStop(0, `rgba(255, 215, 106, ${0.22 * state.coreGlow * pulse + 0.05})`);
    core.addColorStop(0.35, `rgba(255, 190, 80, ${0.10 * state.coreGlow * pulse})`);
    core.addColorStop(1, 'rgba(255, 190, 80, 0)');
    context.fillStyle = core;
    context.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    context.fillStyle = `rgba(255, 225, 150, ${0.25 + 0.55 * state.coreGlow})`;
    context.beginPath();
    context.arc(cx, cy, 7 + state.coreGlow * 9, 0, TAU);
    context.fill();
    // Stars, twinkling.
    for (const s of state.stars) {
      const a = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(state.time * s.speed + s.phase));
      context.fillStyle = `rgba(220, 228, 255, ${a.toFixed(3)})`;
      context.fillRect(s.x, s.y, s.r, s.r);
    }
  }

  function drawPlayer(state) {
    const p = state.player;
    if (!p.alive) return;
    // Blink while invulnerable after a hit.
    if (p.invuln > 0 && p.dashTimer <= 0 && Math.floor(state.time * 14) % 2 === 0) return;
    context.save();
    context.translate(p.x, p.y);
    // Engine flame.
    const flameLen = (16 + 10 * p.flame) * (Math.hypot(p.vx, p.vy) > 40 ? 1 : 0.4);
    context.rotate(p.angle);
    context.globalCompositeOperation = 'lighter';
    const flame = context.createLinearGradient(-PLAYER.radius, 0, -PLAYER.radius - flameLen, 0);
    flame.addColorStop(0, p.over ? 'rgba(57, 213, 255, 0.9)' : 'rgba(255, 179, 71, 0.9)');
    flame.addColorStop(1, 'rgba(255, 120, 40, 0)');
    context.fillStyle = flame;
    context.beginPath();
    context.moveTo(-PLAYER.radius + 2, -6);
    context.lineTo(-PLAYER.radius - flameLen, 0);
    context.lineTo(-PLAYER.radius + 2, 6);
    context.closePath();
    context.fill();
    context.globalCompositeOperation = 'source-over';
    // Hull: a sleek arrow.
    context.fillStyle = PALETTE.player;
    context.beginPath();
    context.moveTo(PLAYER.radius + 6, 0);
    context.lineTo(-PLAYER.radius + 2, -11);
    context.lineTo(-PLAYER.radius + 9, 0);
    context.lineTo(-PLAYER.radius + 2, 11);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.playerCore;
    context.beginPath();
    context.arc(2, 0, 5, 0, TAU);
    context.fill();
    context.strokeStyle = 'rgba(255, 243, 196, 0.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(PLAYER.radius + 6, 0);
    context.lineTo(-PLAYER.radius + 2, -11);
    context.lineTo(-PLAYER.radius + 9, 0);
    context.lineTo(-PLAYER.radius + 2, 11);
    context.closePath();
    context.stroke();
    context.restore();
    // Shield ring while dashing or invulnerable.
    if (p.dashTimer > 0 || p.invuln > 0) {
      const a = p.dashTimer > 0 ? 0.9 : 0.35 + 0.25 * Math.sin(state.time * 16);
      context.strokeStyle = p.over ? `rgba(57, 213, 255, ${a})` : `rgba(255, 215, 106, ${a})`;
      context.lineWidth = 2.5;
      context.beginPath();
      context.arc(p.x, p.y, PLAYER.radius + 9, 0, TAU);
      context.stroke();
    }
    // Dash cooldown ring: a thin arc that fills as the dash recharges.
    if (p.dashCd > 0) {
      const frac = 1 - p.dashCd / PLAYER.dashCooldown;
      context.strokeStyle = 'rgba(57, 213, 255, 0.55)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(p.x, p.y, PLAYER.radius + 16, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      context.stroke();
    }
  }

  function drawEnemies(state) {
    for (const e of state.enemies) {
      if (!e.active) continue;
      const flash = e.flash > 0;
      if (e.kind === KIND_WISP) {
        const spawnScale = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = 'rgba(255, 93, 162, 0.25)';
        context.beginPath();
        context.arc(e.x, e.y, e.r * 1.9 * spawnScale, 0, TAU);
        context.fill();
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = flash ? '#ffffff' : PALETTE.wisp;
        context.beginPath();
        context.arc(e.x, e.y, e.r * spawnScale, 0, TAU);
        context.fill();
        context.fillStyle = '#ffd7ea';
        context.beginPath();
        context.arc(e.x - e.r * 0.3, e.y - e.r * 0.2, e.r * 0.32 * spawnScale, 0, TAU);
        context.fill();
        // Eyes, looking at the player.
        const dx = state.player.x - e.x;
        const dy = state.player.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const ex = (dx / d) * 2.5;
        const ey = (dy / d) * 2.5;
        context.fillStyle = '#1b0b16';
        context.beginPath();
        context.arc(e.x - 4.5 + ex, e.y - 1 + ey, 2.4, 0, TAU);
        context.arc(e.x + 4.5 + ex, e.y - 1 + ey, 2.4, 0, TAU);
        context.fill();
      } else if (e.kind === KIND_DARTER) {
        const telegraph = e.state === 1;
        if (telegraph) {
          // Dashed aim line while it winds up its lunge.
          const blink = Math.floor(state.time * 14) % 2 === 0;
          context.strokeStyle = blink ? 'rgba(255, 93, 108, 0.8)' : 'rgba(255, 93, 108, 0.25)';
          context.lineWidth = 2;
          context.setLineDash([8, 8]);
          context.beginPath();
          context.moveTo(e.x, e.y);
          context.lineTo(state.player.x, state.player.y);
          context.stroke();
          context.setLineDash([]);
        }
        context.save();
        context.translate(e.x, e.y);
        context.rotate(Math.atan2(state.player.y - e.y, state.player.x - e.x));
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = 'rgba(57, 213, 255, 0.22)';
        context.beginPath();
        context.arc(0, 0, e.r * 1.8, 0, TAU);
        context.fill();
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = flash ? '#ffffff' : telegraph ? '#ff8fa3' : PALETTE.darter;
        context.beginPath();
        context.moveTo(e.r + 4, 0);
        context.lineTo(0, -e.r);
        context.lineTo(-e.r - 2, 0);
        context.lineTo(0, e.r);
        context.closePath();
        context.fill();
        context.fillStyle = '#dff8ff';
        context.beginPath();
        context.moveTo(e.r * 0.45, 0);
        context.lineTo(0, -e.r * 0.45);
        context.lineTo(-e.r * 0.45, 0);
        context.lineTo(0, e.r * 0.45);
        context.closePath();
        context.fill();
        context.restore();
      } else {
        // Bulwark: a heavy hexagon with an HP bar.
        const spawnScale = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = 'rgba(255, 138, 61, 0.22)';
        context.beginPath();
        context.arc(e.x, e.y, e.r * 1.7 * spawnScale, 0, TAU);
        context.fill();
        context.globalCompositeOperation = 'source-over';
        context.save();
        context.translate(e.x, e.y);
        context.rotate(state.time * 0.4);
        context.fillStyle = flash ? '#ffffff' : PALETTE.bulwark;
        context.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * TAU;
          const px = Math.cos(a) * e.r * spawnScale;
          const py = Math.sin(a) * e.r * spawnScale;
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
        context.fillStyle = '#ffd9b0';
        context.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * TAU;
          const px = Math.cos(a) * e.r * 0.45 * spawnScale;
          const py = Math.sin(a) * e.r * 0.45 * spawnScale;
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
        context.restore();
        if (e.hp < e.maxHp) {
          const w = 44;
          const frac = Math.max(0, e.hp / e.maxHp);
          context.fillStyle = 'rgba(0, 0, 0, 0.55)';
          context.fillRect(e.x - w / 2, e.y - e.r - 14, w, 6);
          context.fillStyle = PALETTE.bulwark;
          context.fillRect(e.x - w / 2, e.y - e.r - 14, w * frac, 6);
        }
      }
    }
  }

  function drawBullets(state) {
    context.globalCompositeOperation = 'lighter';
    for (const b of state.bullets) {
      if (!b.active) continue;
      const len = Math.hypot(b.vx, b.vy) || 1;
      const nx = b.vx / len;
      const ny = b.vy / len;
      context.strokeStyle = PALETTE.bullet;
      context.lineWidth = 4;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(b.x - nx * 12, b.y - ny * 12);
      context.lineTo(b.x, b.y);
      context.stroke();
      context.fillStyle = 'rgba(255, 233, 163, 0.35)';
      context.beginPath();
      context.arc(b.x, b.y, 7, 0, TAU);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
  }

  function drawShards(state) {
    for (const s of state.shards) {
      if (!s.active) continue;
      const blink = 0.6 + 0.4 * Math.sin(s.spin * 2);
      context.save();
      context.translate(s.x, s.y);
      context.rotate(s.spin);
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = `rgba(255, 215, 106, ${0.3 * blink})`;
      context.beginPath();
      context.arc(0, 0, 12, 0, TAU);
      context.fill();
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = PALETTE.shard;
      context.beginPath();
      context.moveTo(0, -7);
      context.lineTo(5, 0);
      context.lineTo(0, 7);
      context.lineTo(-5, 0);
      context.closePath();
      context.fill();
      context.fillStyle = '#fff3c4';
      context.beginPath();
      context.moveTo(0, -3.5);
      context.lineTo(2.5, 0);
      context.lineTo(0, 3.5);
      context.lineTo(-2.5, 0);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  function drawPickups(state) {
    for (const p of state.pickups) {
      if (!p.active) continue;
      const bob = Math.sin(state.time * 4 + p.x) * 3;
      const blink = p.life < 3 ? (Math.floor(state.time * 8) % 2 === 0 ? 1 : 0.3) : 1;
      context.save();
      context.globalAlpha = blink;
      if (p.kind === 0) {
        context.fillStyle = PALETTE.heart;
        heartPath(context, p.x, p.y + bob, 11);
        context.fill();
        context.fillStyle = 'rgba(255, 255, 255, 0.75)';
        heartPath(context, p.x, p.y + bob - 1, 5);
        context.fill();
      } else {
        context.translate(p.x, p.y + bob);
        context.rotate(state.time * 1.5);
        context.fillStyle = PALETTE.over;
        context.beginPath();
        context.moveTo(0, -13);
        context.lineTo(3.5, -3.5);
        context.lineTo(13, 0);
        context.lineTo(3.5, 3.5);
        context.lineTo(0, 13);
        context.lineTo(-3.5, 3.5);
        context.lineTo(-13, 0);
        context.lineTo(-3.5, -3.5);
        context.closePath();
        context.fill();
        context.fillStyle = '#dff8ff';
        context.beginPath();
        context.arc(0, 0, 4, 0, TAU);
        context.fill();
      }
      context.restore();
    }
  }

  function drawParticles(state) {
    context.globalCompositeOperation = 'lighter';
    for (const p of state.particles) {
      if (!p.active) continue;
      const frac = p.life / p.maxLife;
      context.globalAlpha = frac;
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.size * (0.5 + frac * 0.7), 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  function drawFloaters(state) {
    context.textBaseline = 'alphabetic';
    for (const f of state.floaters) {
      if (!f.active) continue;
      const frac = f.life / f.maxLife;
      context.globalAlpha = Math.min(1, frac * 1.6);
      text(f.text, f.x, f.y, f.size, f.color, 'center', '700');
    }
    context.globalAlpha = 1;
  }

  function drawHud(state, screen, muted) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 24, 18, 30, PALETTE.text, 'left', '700');
    // Combo multiplier with its decay bar.
    if (state.mult > 1 || state.combo > 0) {
      const label = multLabel(state.mult) + ' COMBO';
      text(label, 24, 56, 22, PALETTE.gold, 'left', '700');
      const barW = 130;
      const frac = Math.max(0, state.comboTimer / 3);
      context.fillStyle = 'rgba(255, 255, 255, 0.14)';
      context.fillRect(24, 82, barW, 6);
      context.fillStyle = PALETTE.gold;
      context.fillRect(24, 82, barW * frac, 6);
    }
    // Wave and enemies left.
    text(waveLabel(state.wave), FIELD.width / 2, 18, 30, PALETTE.text, 'center', '700');
    let alive = 0;
    for (const e of state.enemies) if (e.active) alive += 1;
    const left = state.waveState === 'active' ? alive + state.spawnQueue.length : 0;
    if (screen === SCREEN_PLAY && state.waveState === 'active') {
      text(leftLabel(left), FIELD.width / 2, 54, 18, PALETTE.muted, 'center');
    }
    // Hearts.
    const heartX = FIELD.width - 24 - 3 * 34 - 62;
    for (let i = 0; i < PLAYER.maxHp; i += 1) {
      context.fillStyle = i < state.player.hp ? PALETTE.heart : 'rgba(255, 255, 255, 0.14)';
      heartPath(context, heartX + i * 34 + 11, 30, 11);
      context.fill();
    }
    // Dash readiness.
    const dashReady = state.player.dashCd <= 0;
    text('DASH', 24, FIELD.height - 34, 16, dashReady ? PALETTE.over : PALETTE.muted, 'left', '700');
    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    context.fillRect(76, FIELD.height - 30, 90, 7);
    context.fillStyle = dashReady ? PALETTE.over : 'rgba(57, 213, 255, 0.5)';
    context.fillRect(76, FIELD.height - 30, 90 * (dashReady ? 1 : 1 - state.player.dashCd / PLAYER.dashCooldown), 7);
    // Overcharge timer.
    if (state.player.over) {
      const frac = Math.max(0, state.player.overTimer / 8);
      text('OVERCHARGE', FIELD.width / 2, FIELD.height - 34, 16, PALETTE.over, 'center', '700');
      context.fillStyle = 'rgba(255, 255, 255, 0.14)';
      context.fillRect(FIELD.width / 2 - 70, FIELD.height - 14, 140, 7);
      context.fillStyle = PALETTE.over;
      context.fillRect(FIELD.width / 2 - 70, FIELD.height - 14, 140 * frac, 7);
    }
    // Mute button.
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    context.beginPath();
    context.arc(MUTE_RECT.x + MUTE_RECT.w / 2, MUTE_RECT.y + MUTE_RECT.h / 2, 22, 0, TAU);
    context.fill();
    context.strokeStyle = PALETTE.muted;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(MUTE_RECT.x + MUTE_RECT.w / 2, MUTE_RECT.y + MUTE_RECT.h / 2, 22, 0, TAU);
    context.stroke();
    const mx = MUTE_RECT.x + 14;
    const my = MUTE_RECT.y + 17;
    context.fillStyle = PALETTE.text;
    context.fillRect(mx, my + 6, 6, 10);
    context.beginPath();
    context.moveTo(mx + 6, my + 6);
    context.lineTo(mx + 13, my - 1);
    context.lineTo(mx + 13, my + 23);
    context.lineTo(mx + 6, my + 16);
    context.closePath();
    context.fill();
    if (muted) {
      context.strokeStyle = PALETTE.danger;
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(mx + 18, my + 2);
      context.lineTo(mx + 30, my + 20);
      context.moveTo(mx + 30, my + 2);
      context.lineTo(mx + 18, my + 20);
      context.stroke();
    } else {
      context.strokeStyle = PALETTE.text;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(mx + 18, my + 11, 7, -0.9, 0.9);
      context.stroke();
      context.beginPath();
      context.arc(mx + 18, my + 11, 11, -0.9, 0.9);
      context.stroke();
    }
    // Wave banner.
    if (screen === SCREEN_PLAY && state.waveState === 'intro') {
      context.textBaseline = 'alphabetic';
      const frac = Math.min(1, (WAVE.intermission - state.interTimer) * 2);
      context.globalAlpha = Math.min(1, frac);
      text('WAVE ' + state.wave, FIELD.width / 2, FIELD.height / 2 - 130, 64, PALETTE.gold, 'center', '800');
      context.globalAlpha = Math.min(1, frac) * 0.9;
      text(state.wave === 10 ? 'The last wave. Hold the light.' : 'Clear every void creature', FIELD.width / 2, FIELD.height / 2 - 92, 22, PALETTE.muted, 'center');
      context.globalAlpha = 1;
    }
    // Controls hint, first seconds of play.
    if (screen === SCREEN_PLAY && state.hintTimer > 0 && state.wave === 1 && state.time < 8) {
      context.globalAlpha = Math.min(1, state.hintTimer);
      text('WASD / arrows to move · mouse to aim · hold click or Space to fire · Shift to dash', FIELD.width / 2, FIELD.height - 64, 18, PALETTE.muted, 'center');
      context.globalAlpha = 1;
    }
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const top = 118;
    const line = 32;
    const bottom = 74;
    const height = top + lines.length * line + bottom;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(4, 6, 16, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.panel;
    if (typeof context.roundRect === 'function') {
      context.beginPath();
      context.roundRect(x, y, width, height, 18);
      context.fill();
    } else {
      context.fillRect(x, y, width, height);
    }
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    if (typeof context.roundRect === 'function') {
      context.beginPath();
      context.roundRect(x, y, width, height, 18);
      context.stroke();
    } else {
      context.strokeRect(x, y, width, height);
    }
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 76, 46, accent || PALETTE.text, 'center', '800');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + top + index * line, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 38, 23, PALETTE.gold, 'center', '700');
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, ui) {
    const best = ui.best || 0;
    const muted = !!ui.muted;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Screen shake: a deterministic wobble from the world's clock.
    const sx = Math.sin(state.time * 127.1) * state.shake;
    const sy = Math.cos(state.time * 141.3) * state.shake;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + sx * view.scale, view.y + sy * view.scale);
    drawBackground(state);
    drawShards(state);
    drawPickups(state);
    drawEnemies(state);
    drawBullets(state);
    drawPlayer(state);
    drawParticles(state);
    drawFloaters(state);
    // Hit flash: a red vignette that fades.
    if (state.flash > 0) {
      context.fillStyle = `rgba(255, 40, 60, ${(state.flash * 0.28).toFixed(3)})`;
      context.fillRect(-40, -40, FIELD.width + 80, FIELD.height + 80);
    }
    if (screen === SCREEN_TITLE) {
      drawPanel(
        'LUMENFALL',
        [
          'The last star is dying. You are its keeper.',
          'Blast the void creatures. Gather starshards to raise your combo.',
          'WASD / arrows move · mouse aims · hold click or Space to fire',
          'Shift or right-click to dash through danger · P pauses · M mutes',
          'Clear all 10 waves to relight the star. Then keep going, endless.',
          bestLabel(best),
        ],
        'Press Space or click to start',
        PALETTE.gold,
      );
      return;
    }
    drawHud(state, screen, muted);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The void waits for you.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      drawPanel(
        'The light fades',
        [finalLabel(state.score), bestLabel(best), 'Wave reached: ' + state.wave, 'Void creatures destroyed: ' + state.kills],
        'Press Space or R to try again',
        PALETTE.danger,
      );
    } else if (screen === SCREEN_WIN) {
      drawPanel(
        'THE STAR REIGNITES',
        [finalLabel(state.score), bestLabel(best), 'All 10 waves cleared. The light is yours.', ''],
        'Space: keep going, endless · R: start over',
        PALETTE.gold,
      );
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField };
}
