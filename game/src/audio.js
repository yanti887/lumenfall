// Sound for LUMENFALL, synthesised with the Web Audio API: no audio files, everything
// is an oscillator or filtered noise made in code. The context is created on the first
// user gesture (browsers block audio before one) and every call is a safe no-op until
// then, so the title screen and the screenshot scenes stay silent without errors.

import { MUTE_KEY } from './config.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    muted = false;
  }

  function ensure() {
    if (ctx !== null) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.45;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, endFreq, dur, type, vol, delay) {
    if (ctx === null || muted) return;
    try {
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      // Audio is decoration: never let it break the game.
    }
  }

  function noise(dur, vol, freq, delay) {
    if (ctx === null || muted) return;
    try {
      const t0 = ctx.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(t0);
    } catch {
      // Audio is decoration: never let it break the game.
    }
  }

  return {
    /** Call from a user gesture so the browser lets audio start. */
    unlock() {
      ensure();
    },
    isMuted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      try {
        window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // Storage can be off: the mute then lasts this visit only.
      }
      if (master !== null) master.gain.value = muted ? 0 : 0.45;
    },
    shoot() {
      tone(920, 240, 0.07, 'square', 0.08);
    },
    explode() {
      noise(0.28, 0.32, 900);
      tone(170, 42, 0.22, 'sine', 0.28);
    },
    bigExplode() {
      noise(0.45, 0.4, 600);
      tone(120, 30, 0.4, 'sine', 0.36);
      tone(90, 28, 0.5, 'triangle', 0.2, 0.05);
    },
    shard(combo) {
      const base = 1180 + Math.min(combo, 24) * 28;
      tone(base, base * 1.5, 0.07, 'sine', 0.1);
    },
    hit() {
      noise(0.22, 0.4, 420);
      tone(120, 46, 0.26, 'sawtooth', 0.3);
    },
    dash() {
      noise(0.14, 0.16, 2600);
    },
    pickup() {
      tone(660, 990, 0.12, 'sine', 0.16);
      tone(990, 1320, 0.12, 'sine', 0.12, 0.08);
    },
    waveClear() {
      tone(523, 523, 0.12, 'triangle', 0.18);
      tone(659, 659, 0.12, 'triangle', 0.18, 0.1);
      tone(784, 784, 0.12, 'triangle', 0.18, 0.2);
      tone(1046, 1046, 0.22, 'triangle', 0.2, 0.3);
    },
    win() {
      const notes = [523, 659, 784, 1046, 1318, 1568];
      for (let i = 0; i < notes.length; i += 1) tone(notes[i], notes[i], 0.22, 'triangle', 0.18, i * 0.11);
    },
    over() {
      tone(392, 392, 0.25, 'triangle', 0.2);
      tone(311, 311, 0.25, 'triangle', 0.2, 0.22);
      tone(233, 180, 0.5, 'triangle', 0.22, 0.44);
    },
  };
}
