// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between five screens: title, play, paused, game over and victory.
//
// ?seed=N fixes the pattern. ?shot=start|play|win|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, MUTE_RECT, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_DASH, EVENT_FIRE, EVENT_HIT, EVENT_KILL, EVENT_OVER, EVENT_PICKUP, EVENT_SHARD, EVENT_WAVE, EVENT_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { ambientPilot, stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, { best: scene.best, muted: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, renderer.toField);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  // A small debug handle (read-only state for testing).

  // The first gesture unlocks audio (browsers block it before one).
  function unlockAudio() {
    audio.unlock();
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. 3 hull. Clear 10 waves to relight the star.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    audio.over();
    announce(`Game over. Score ${world.state.score}. Best ${best}.`);
  }

  function winGame() {
    screen = SCREEN_WIN;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    audio.win();
    announce(`Victory. The star reignites. Score ${world.state.score}. Best ${best}.`);
  }

  function toggleMute() {
    audio.setMuted(!audio.isMuted());
  }

  function playEvents(events) {
    if (events & EVENT_HIT) audio.hit();
    if (events & EVENT_KILL) audio.explode();
    if (events & EVENT_SHARD) audio.shard(world.state.combo);
    if (events & EVENT_WAVE) audio.waveClear();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_DASH) audio.dash();
    if (events & EVENT_FIRE) audio.shoot();
  }

  function handleActions() {
    // A click on the mute button toggles sound and is not a confirm or a shot.
    const clicks = input.takeClicks();
    let mutedClick = false;
    for (const click of clicks) {
      if (click.x >= MUTE_RECT.x && click.x <= MUTE_RECT.x + MUTE_RECT.w && click.y >= MUTE_RECT.y && click.y <= MUTE_RECT.y + MUTE_RECT.h) {
        toggleMute();
        mutedClick = true;
      }
    }
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) toggleMute();
    if (mutedClick && !(actions & (ACTION_PAUSE | ACTION_RESTART))) {
      // A mute click alone does nothing else.
    } else if (actions & ACTION_RESTART && (screen === SCREEN_OVER || screen === SCREEN_WIN || screen === SCREEN_PLAY)) {
      startGame();
    } else if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) {
      startGame();
    } else if (actions & ACTION_CONFIRM && screen === SCREEN_OVER) {
      startGame();
    } else if (actions & ACTION_CONFIRM && screen === SCREEN_WIN) {
      world.continueEndless();
      screen = SCREEN_PLAY;
      announce('Endless. The void keeps coming.');
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, ambientPilot(world.state), true);
      return;
    }
    if (screen === SCREEN_WIN) {
      world.step(STEP, { mx: 0, my: 0, aimX: world.state.player.x, aimY: world.state.player.y - 100, fire: false, dash: false, hasMouse: false }, true);
      return;
    }
    if (screen === SCREEN_OVER) {
      world.step(STEP, { mx: 0, my: 0, aimX: world.state.player.x, aimY: world.state.player.y - 100, fire: false, dash: false, hasMouse: false }, true);
      return;
    }
    const move = input.move();
    const aim = input.aim();
    const events = world.step(STEP, {
      mx: move.x,
      my: move.y,
      aimX: aim.x,
      aimY: aim.y,
      fire: input.firing() || false,
      dash: input.takeDash(),
      hasMouse: aim.hasMouse,
    }, false);
    playEvents(events);
    if (events & EVENT_WIN) winGame();
    else if (events & EVENT_OVER) endGame();
    else if (events & EVENT_HIT) announce(world.state.player.hp === 1 ? 'Hit. 1 hull left.' : `Hit. ${world.state.player.hp} hull left.`);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY || screen === SCREEN_WIN || screen === SCREEN_OVER) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY || screen === SCREEN_WIN || screen === SCREEN_OVER)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, { best, muted: audio.isMuted() });
  }

  // Leaving the tab pauses a running game rather than letting creatures close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Lumenfall. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
