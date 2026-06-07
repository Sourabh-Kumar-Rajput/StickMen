// ---------------------------------------------------------------------------
// audio.js — global `Sound`: procedural Web Audio SFX + a looping music bed.
// No audio files. AudioContext is created lazily and resumed on the first user
// gesture (autoplay policy). Master volume + mute persist to localStorage with
// a try/catch wrapper (file:// / private-mode safe). Every voice auto-frees.
// Depends only on clamp() from utils.js. No-op gracefully until unlocked.
// ---------------------------------------------------------------------------
"use strict";

const Sound = (function () {
  const KEY_VOL = "sa_audio_vol", KEY_MUTE = "sa_audio_muted";
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let unlocked = false, muted = false, volume = 0.8, loaded = false;
  let activeVoices = 0; const MAX_VOICES = 24;
  let music = null, pendingMusic = null;

  function load(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function init() {
    if (loaded) return;
    volume = clamp(parseFloat(load(KEY_VOL, "0.8")) || 0.8, 0, 1);
    muted = load(KEY_MUTE, "0") === "1";
    loaded = true;
  }

  function applyGain() { if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02); }

  function unlock() {
    init();
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 1; musicBus.connect(master);
      master.gain.value = muted ? 0 : volume;
    }
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    unlocked = true;
    if (pendingMusic) { const t = pendingMusic; pendingMusic = null; startMusic(t); }
  }

  function env(g, peak, a, d) {
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noiseBuffer(dur) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function freeOn(node, g) { node.onended = function () { activeVoices--; try { g.disconnect(); } catch (e) {} }; }

  // build a voice graph: returns a gain node connected (optionally panned) to sfxBus
  function makeGain(pan) {
    const g = ctx.createGain(); g.gain.value = 0;
    let out = g;
    if (pan != null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); out = p;
    }
    out.connect(sfxBus);
    return g;
  }

  const SFX = {
    bowDraw: function (g, base) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(120, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.32);
      env(g, base * 0.22, 0.02, 0.34); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.4); freeOn(o, g);
    },
    release: function (g, base) {
      const o = ctx.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(330, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.12);
      env(g, base * 0.5, 0.005, 0.14); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.18); freeOn(o, g);
    },
    thunk: function (g, base) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.08);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
      env(g, base * 0.5, 0.002, 0.09); s.connect(lp); lp.connect(g); s.start(); freeOn(s, g);
    },
    flesh: function (g, base) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.12);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 300;
      env(g, base * 0.7, 0.002, 0.13); s.connect(bp); bp.connect(g); s.start(); freeOn(s, g);
    },
    headshot: function (g, base) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.18);
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(620, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.2);
      env(g, base * 0.9, 0.001, 0.22); s.connect(hp); hp.connect(g); o.connect(g);
      s.start(); o.start(); o.stop(ctx.currentTime + 0.24); freeOn(o, g);
    },
    block: function (g, base) {
      const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 520;
      const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 770;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 6;
      env(g, base * 0.6, 0.001, 0.18); o.connect(bp); o2.connect(bp); bp.connect(g);
      o.start(); o2.start(); o.stop(ctx.currentTime + 0.2); o2.stop(ctx.currentTime + 0.2); freeOn(o, g);
    },
    explosion: function (g, base) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.5);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(1800, ctx.currentTime);
      lp.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.45);
      const sub = ctx.createOscillator(); sub.type = "sine";
      sub.frequency.setValueAtTime(90, ctx.currentTime);
      sub.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
      env(g, base, 0.004, 0.5); s.connect(lp); lp.connect(g); sub.connect(g);
      s.start(); sub.start(); sub.stop(ctx.currentTime + 0.5); freeOn(s, g);
    },
    enemyDeath: function (g, base) {
      const o = ctx.createOscillator(); o.type = "square";
      o.frequency.setValueAtTime(220, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.18);
      env(g, base * 0.4, 0.004, 0.2); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.22); freeOn(o, g);
    },
    waveStart: function (g, base) { blip(g, base, [392, 587], 0.12); },
    levelComplete: function (g, base) { blip(g, base, [392, 494, 659], 0.14); },
    victory: function (g, base) { blip(g, base, [392, 494, 587, 784], 0.16); },
    defeat: function (g, base) { blip(g, base, [294, 233, 175], 0.22, "sine"); },
    click: function (g, base) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 760;
      env(g, base * 0.3, 0.001, 0.05); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.06); freeOn(o, g);
    },
    bossWarn: function (g, base) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(110, ctx.currentTime);
      o.frequency.linearRampToValueAtTime(70, ctx.currentTime + 0.6);
      env(g, base * 0.5, 0.05, 0.6); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.7); freeOn(o, g);
    }
  };

  function blip(g, base, notes, step, type) {
    const t0 = ctx.currentTime;
    for (let i = 0; i < notes.length; i++) {
      const o = ctx.createOscillator(); o.type = type || "triangle";
      o.frequency.setValueAtTime(notes[i], t0 + i * step);
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0.0001, t0 + i * step);
      gg.gain.linearRampToValueAtTime(base * 0.5, t0 + i * step + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0001, t0 + i * step + step * 0.95);
      o.connect(gg); gg.connect(g); o.start(t0 + i * step); o.stop(t0 + i * step + step);
      if (i === notes.length - 1) o.onended = function () { activeVoices--; try { g.disconnect(); } catch (e) {} };
    }
    g.gain.value = 1; // sub-gains shape the envelope
  }

  function play(name, opts) {
    if (!ctx || !unlocked || muted) return;
    opts = opts || {};
    const fn = SFX[name]; if (!fn) return;
    if (activeVoices >= MAX_VOICES) return;
    const g = makeGain(opts.pan);
    activeVoices++;
    try { fn(g, opts.gain != null ? opts.gain : 1); }
    catch (e) { activeVoices--; try { g.disconnect(); } catch (_) {} }
  }

  // ---- music: a slow looping chord pad + bass, per theme ----
  const THEMES = {
    menu:     { root: 196, chord: [0, 4, 7], type: "triangle" },
    field:    { root: 220, chord: [0, 4, 7], type: "triangle" },
    survival: { root: 174, chord: [0, 3, 7], type: "sawtooth" },
    campaign: { root: 165, chord: [0, 3, 7], type: "triangle" },
    boss:     { root: 110, chord: [0, 3, 6], type: "sawtooth" }
  };
  function semis(root, n) { return root * Math.pow(2, n / 12); }

  function startMusic(theme) {
    if (!ctx || !unlocked) { pendingMusic = theme; return; }
    if (music && music.theme === theme) return;
    stopMusic();
    const cfg = THEMES[theme] || THEMES.menu;
    const mg = ctx.createGain(); mg.gain.value = 0; mg.connect(musicBus);
    const nodes = [];
    // bass
    const bass = ctx.createOscillator(); bass.type = "sine"; bass.frequency.value = cfg.root / 2;
    const bg = ctx.createGain(); bg.gain.value = 0.18; bass.connect(bg); bg.connect(mg); bass.start(); nodes.push(bass);
    // pad chord through a slow lowpass
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.connect(mg);
    for (const iv of cfg.chord) {
      const o = ctx.createOscillator(); o.type = cfg.type; o.frequency.value = semis(cfg.root, iv);
      o.detune.value = (iv * 2) - 4;
      const og = ctx.createGain(); og.gain.value = 0.06; o.connect(og); og.connect(lp); o.start(); nodes.push(o);
    }
    // gentle tremolo LFO on the pad
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.18;
    const lfg = ctx.createGain(); lfg.gain.value = 180; lfo.connect(lfg); lfg.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    mg.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.5);
    music = { theme: theme, mg: mg, nodes: nodes };
  }
  function stopMusic() {
    if (!music) return;
    const m = music; music = null;
    try {
      m.mg.gain.cancelScheduledValues(ctx.currentTime);
      m.mg.gain.setValueAtTime(m.mg.gain.value, ctx.currentTime);
      m.mg.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    } catch (e) {}
    const t = ctx.currentTime + 0.34;
    m.nodes.forEach(function (n) { try { n.stop(t); } catch (e) {} });
    setTimeout(function () { try { m.mg.disconnect(); } catch (e) {} }, 420);
  }
  function setMusicGain(v) { if (music) music.mg.gain.setTargetAtTime(clamp(v, 0, 1) * 0.6, ctx.currentTime, 0.05); }

  function setMuted(b) { init(); muted = !!b; save(KEY_MUTE, muted ? "1" : "0"); if (ctx) applyGain(); }
  function toggleMuted() { setMuted(!muted); return muted; }
  function setVolume(v) { init(); volume = clamp(v, 0, 1); save(KEY_VOL, String(volume)); if (ctx) applyGain(); }

  // resume audio when returning to a backgrounded tab/app
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && ctx && ctx.state === "suspended") ctx.resume().catch(function () {});
    });
  }

  return {
    init: init, unlock: unlock, play: play,
    startMusic: startMusic, stopMusic: stopMusic, setMusicGain: setMusicGain,
    setMuted: setMuted, toggleMuted: toggleMuted, isMuted: function () { return muted; },
    setVolume: setVolume, getVolume: function () { return volume; }
  };
})();
