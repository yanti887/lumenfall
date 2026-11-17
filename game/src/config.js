// LUMENFALL — every tuning number and colour in one place. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule below depends
// on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Clear this wave to win the game. */
export const WIN_WAVE = 10;

export const PLAYER = {
  radius: 15,
  speed: 360,
  accel: 2800,
  drag: 6.0,
  hp: 3,
  maxHp: 3,
  fireInterval: 0.15,
  overInterval: 0.07,
  bulletSpeed: 780,
  bulletRadius: 5,
  bulletLife: 1.1,
  dashSpeed: 1000,
  dashTime: 0.16,
  dashCooldown: 1.5,
  invulnerable: 1.3,
};

export const ENEMY = {
  wisp:    { radius: 13, hp: 1, speed: 150, speedPerWave: 7,  score: 50,  shards: 1 },
  darter:  { radius: 15, hp: 2, speed: 125, speedPerWave: 6,  lungeSpeed: 560, telegraph: 0.65, score: 100, shards: 2 },
  bulwark: { radius: 27, hp: 6, speed: 54,  speedPerWave: 3,  score: 200, shards: 4 },
};

/** A shard's base value; the combo multiplier applies on top of it. */
export const SHARD = { value: 10, comboWindow: 3.0, magnetRadius: 180, collectRadius: 28, maxMult: 8, comboPerMult: 6 };

export const WAVE = { clearBonus: 250, intermission: 2.4, maxAlive: 24 };

export const PICKUP = { heartChance: 0.14, overChance: 0.14, overTime: 8, heartScore: 500 };

export const POOL = { bullets: 96, enemies: 40, shards: 140, particles: 360, floaters: 24, pickups: 12 };

export const PALETTE = {
  backdrop: '#070a18',
  skyTop: '#0e1334',
  skyBottom: '#04050e',
  core: '#ffd76a',
  player: '#ffd76a',
  playerCore: '#fff3c4',
  bullet: '#ffe9a3',
  wisp: '#ff5da2',
  darter: '#39d5ff',
  bulwark: '#ff8a3d',
  shard: '#ffd76a',
  heart: '#ff5d6c',
  over: '#39d5ff',
  panel: '#131a33',
  panelEdge: '#2e3a68',
  text: '#eef1f5',
  muted: '#9aa3bd',
  danger: '#ff5d6c',
  gold: '#ffd76a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'lumenfall.best';
export const MUTE_KEY = 'lumenfall.muted';

/** The mute button's rectangle, in field coordinates (top-right corner). */
export const MUTE_RECT = { x: 1212, y: 14, w: 52, h: 52 };
