// TELL — browser shell. Wires the production core to the renderer, audio, HUD,
// input, tutorial, settings and save state. No game logic lives here.
import * as G from '../core/game.js';
import { UPGRADES } from '../core/upgrades.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const $ = id => document.getElementById(id);
const SAVE = 'tell.save.v1', SET = 'tell.settings.v1', BEST = 'tell.best.v1';

const settings = Object.assign({
  volume: 0.8, mute: false, shake: true, reducedMotion: false,
  colourblind: false, highContrast: false, fontScale: 1, habitDefault: false,
}, load(SET, {}));

let run = null;
let screenName = 'title';
let v = { pfx: 0, pfy: 0, habitOn: false };
let tweenFrom = null;
let decoyArmed = false;
let inputLocked = false;
let tut = {};
const renderer = new Renderer($('stage'));
const audio = new Audio();

// ---------- settings plumbing ----------
function applySettings() {
  document.body.classList.toggle('cb', settings.colourblind);
  document.body.classList.toggle('hc', settings.highContrast);
  renderer.refreshVars();
  document.documentElement.style.setProperty('--scale', settings.fontScale);
  audio.setVolume(settings.volume);
  audio.setMute(settings.mute);
  v.habitOn = settings.habitDefault;
  save(SET, settings);
}
function save(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }
function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }

function buildSettings() {
  const box = $('setlist'); if (!box) return;
  const row = (html) => { const d = document.createElement('div'); d.className = 'setrow'; d.innerHTML = html; return d; };
  box.innerHTML = '';
  const range = (key, label, min, max, step) => {
    const r = row(`<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}">`);
    r.querySelector('input').addEventListener('input', e => { settings[key] = +e.target.value; applySettings(); });
    return r;
  };
  const toggle = (key, label) => {
    const r = row(`<label>${label}</label><input type="checkbox" ${settings[key] ? 'checked' : ''}>`);
    r.querySelector('input').addEventListener('change', e => { settings[key] = e.target.checked; applySettings(); });
    return r;
  };
  box.append(range('volume', 'Volume', 0, 1, 0.05), toggle('mute', 'Mute'),
    range('fontScale', 'Text size', 0.8, 1.4, 0.05), toggle('colourblind', 'Colour-blind palette'),
    toggle('highContrast', 'High contrast'), toggle('shake', 'Screen shake'),
    toggle('reducedMotion', 'Reduced motion'), toggle('habitDefault', 'Show my tells by default'));
}

// ---------- screens ----------
function show(name) {
  screenName = name;
  for (const [id, nm] of [['screen-title', 'title'], ['screen-how', 'how'], ['screen-settings', 'settings'], ['screen-choice', 'choice'], ['screen-end', 'end'], ['screen-pause', 'pause']]) {
    $(id).classList.toggle('hidden', nm !== name);
  }
  const inPlay = name !== 'title';
  $('hud').classList.toggle('hidden', name === 'title');
  $('pad').classList.toggle('hidden', name !== 'play');
  $('actions').classList.toggle('hidden', name !== 'play');
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- HUD ----------
function pips(el, n, max, cls) {
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const p = document.createElement('span');
    p.className = 'pip' + (i < n ? ' on' + (cls ? ' ' + cls : '') : '');
    el.appendChild(p);
  }
}
function hud() {
  if (!run) return;
  pips($('composure'), run.p.composure, G.composureMaxOf(run));
  pips($('nerve'), run.p.nerve, G.nerveMaxOf(run), 'nervep');
  $('breath').textContent = Math.max(0, run.p.breath);
  $('breathbar').style.width = Math.max(0, Math.min(1, run.p.breath / run.cfgKind.breath)) * 100 + '%';
  $('depth').textContent = `Depth ${run.depth}`;
  $('motes').textContent = run.gate.open ? 'Gate open' : `${run.motes.length} motes`;
  $('cost-exhale').textContent = G.cfgOf(run).exhaleCost + ' N';
  $('cost-decoy').textContent = G.cfgOf(run).decoyCost + ' N';
  $('btn-exhale').disabled = run.p.nerve < G.cfgOf(run).exhaleCost;
  $('btn-decoy').disabled = run.p.nerve < G.cfgOf(run).decoyCost;
  // reader rail
  const rail = $('readerrail'); rail.innerHTML = '';
  for (const r of run.readers) {
    const d = document.createElement('div');
    d.className = 'rsig' + (r.stun > 0 ? ' stunned' : r.conf >= 0.6 ? ' confident' : '');
    d.style.setProperty('--c', `var(${readerColor(r)})`);
    d.innerHTML = `<span class="dot" style="background:var(${readerColor(r)})"></span>${G.READER_KINDS[r.kind].name} ${r.stun > 0 ? '—' : Math.round(r.conf * 100) + '%'}`;
    d.title = G.READER_KINDS[r.kind].blurb;
    rail.appendChild(d);
  }
  audio.droneTension(Math.max(0, ...run.readers.map(r => r.conf)));
}
function readerColor(r) {
  return { sentry: '--r1', hound: '--r2', chorus: '--r3', mirror: '--r4', archivist: '--r5' }[r.kind];
}

// ---------- run lifecycle ----------
function newRun(seed) {
  run = G.createRun({ seed: seed ?? (Date.now() % 1e9) });
  tut = {};
  v.pfx = run.p.cell % run.W; v.pfy = (run.p.cell / run.W) | 0;
  v.dx = v.pfx; v.dy = v.pfy;
  decoyArmed = false;
  audio.droneStart();
  persist();
  show('play');
  hud();
  welcome();
}
function welcome() {
  toast('Collect the motes. The dark is watching how you move.', 3200);
}
function persist() { if (run) save(SAVE, G.serialize(run)); }
function clearSave() { try { localStorage.removeItem(SAVE); } catch (e) {} }

function tryContinue() {
  const s = localStorage.getItem(SAVE);
  if (!s) return;
  try {
    run = G.deserialize(s);
    v.pfx = run.p.cell % run.W; v.pfy = (run.p.cell / run.W) | 0;
    v.dx = v.pfx; v.dy = v.pfy;
    audio.droneStart();
    if (run.status === 'descend') { showChoice(); }
    else if (run.status === 'lost' || run.status === 'won') { endGame(); }
    else { show('play'); hud(); }
  } catch (e) { clearSave(); }
}

// ---------- applying an action ----------
function doAction(a) {
  if (!run || run.status !== 'play' || inputLocked) return;
  const ev = G.act(run, a);
  handleEvents(ev);
  v.pfx = run.p.cell % run.W; v.pfy = (run.p.cell / run.W) | 0;

  if (run.status === 'descend') { showChoice(); }
  else if (run.status === 'lost' || run.status === 'won') { endGame(); }
  else { persist(); hud(); }
}

function handleEvents(ev) {
  for (const e of ev) {
    switch (e.type) {
      case 'move': audio.step(e.dir ?? 0); break;
      case 'mote':
        audio.mote(); renderer.burst(run, e.cell, renderer.color('--mote'), 16);
        if (!tut.mote) { tut.mote = 1; toast('Mote taken. It returns Breath.'); }
        break;
      case 'hit':
        audio.hit(); renderer.shock(run, e.cell, renderer.color('--bad'));
        if (settings.shake && !settings.reducedMotion) renderer.shake = 14;
        if (!tut.hit) { tut.hit = 1; toast('It read you. That tile was a trap.', 3200); }
        break;
      case 'startle':
        audio.startle(); renderer.shock(run, run.p.cell, renderer.color('--good'));
        if (settings.shake && !settings.reducedMotion) renderer.shake = 8;
        toast(`Startled! +${e.bonus} Breath. The dark loses its nerve.`, 3000);
        break;
      case 'decoy':
        audio.decoy(); renderer.burst(run, e.target, renderer.color('--r3'), 10);
        if (!tut.decoy) { tut.decoy = 1; toast('A lie planted. The Reader now believes it.'); }
        break;
      case 'exhale': audio.exhale(); toast(`Exhale. +${e.breath} Breath.`); break;
      case 'hush': audio.hush(); if (!tut.hush) { tut.hush = 1; toast('Hush tile. Moving from here teaches it nothing.'); } break;
      case 'gateopen': audio.gate(); renderer.shock(run, run.gate.cell, renderer.color('--gate')); toast('The Gate is open. Reach it.', 3200); break;
      case 'deny': audio.deny(); toast('Not enough Nerve.', 1400); break;
      case 'manufactured': toast('The lie paid off. +Nerve.', 1800); break;
      case 'secondwind': toast('Second Wind. +Breath.', 1600); break;
    }
  }
}

function showChoice() {
  const box = $('choices'); box.innerHTML = '';
  persist();
  for (const id of run.choice) {
    const u = UPGRADES[id];
    const b = document.createElement('button');
    b.className = 'choice';
    b.innerHTML = `<b>${u.name}</b><span>${u.blurb}</span>`;
    b.addEventListener('click', () => {
      audio.descend();
      G.takeUpgrade(run, id);
      v.pfx = run.p.cell % run.W; v.pfy = (run.p.cell / run.W) | 0;
      persist(); hud(); show('play');
      toast(`Depth ${run.depth}. ${run.readers.map(r => G.READER_KINDS[r.kind].name).join(', ')} are waiting.`, 3400);
    });
    box.appendChild(b);
  }
  show('choice');
}

function endGame() {
  clearSave();
  audio.droneStop();
  const won = run.status === 'won';
  won ? audio.win() : audio.lose();
  const best = Math.max(load(BEST, 0), run.best);
  save(BEST, best);
  $('endtitle').textContent = won ? 'Unwritten' : (run.cause === 'caught' ? 'Read' : 'Smothered');
  $('endtext').textContent = won
    ? 'Five depths, and the dark never once finished your sentence.'
    : run.cause === 'caught'
      ? 'It learned you completely. There were no surprises left.'
      : 'The dark closed in, breath by breath.';
  const st = $('endstats'); st.innerHTML = '';
  const add = (b, l) => { const d = document.createElement('div'); d.innerHTML = `<b>${b}</b><span>${l}</span>`; st.appendChild(d); };
  add(run.depth, 'depth');
  add(run.totalMoves, 'moves');
  add(run.totalStartles, 'startles');
  add(run.totalHits, 'hits');
  add(run.upgrades.length, 'unlearnings');
  add(best, 'best depth');
  show('end');
}

// ---------- input ----------
const KEYDIR = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
window.addEventListener('keydown', e => {
  audio.resume();
  if (e.code === 'Escape') {
    if (screenName === 'play') show('pause');
    else if (screenName === 'pause') show('play');
    else if (screenName === 'how' || screenName === 'settings') show(run ? 'play' : 'title');
    return;
  }
  if (screenName !== 'play') return;
  if (e.code === 'Space') { e.preventDefault(); doAction({ type: 'move', dir: G.STAY }); return; }
  if (e.code === 'KeyE') { doAction({ type: 'exhale' }); return; }
  if (e.code === 'KeyH') { v.habitOn = !v.habitOn; toast(v.habitOn ? 'Your tells, revealed.' : 'Tells hidden.', 1200); return; }
  if (e.code === 'KeyQ') { decoyArmed = !decoyArmed; $('btn-decoy').classList.toggle('armed', decoyArmed); toast(decoyArmed ? 'Choose a tile to lie about.' : '', 1500); return; }
  const d = KEYDIR[e.code];
  if (d === undefined) return;
  e.preventDefault();
  if (decoyArmed) {
    const target = G.destOf(run, d);
    decoyArmed = false; $('btn-decoy').classList.remove('armed');
    doAction({ type: 'decoy', cell: target });
  } else {
    doAction({ type: 'move', dir: d });
  }
});

// touch pad
document.querySelectorAll('.pbtn').forEach(b => b.addEventListener('click', () => {
  audio.resume();
  const d = +b.dataset.dir;
  if (decoyArmed) { decoyArmed = false; doAction({ type: 'decoy', cell: G.destOf(run, d) }); }
  else doAction({ type: 'move', dir: d });
}));
$('btn-exhale').addEventListener('click', () => { audio.resume(); doAction({ type: 'exhale' }); });
$('btn-decoy').addEventListener('click', () => { audio.resume(); decoyArmed = !decoyArmed; $('btn-decoy').classList.toggle('armed', decoyArmed); });
$('btn-habit').addEventListener('click', () => { v.habitOn = !v.habitOn; });

// click-to-move on the board
$('stage').addEventListener('pointerdown', e => {
  if (screenName !== 'play' || !run) return;
  audio.resume();
  const L = renderer.layout(run);
  const x = Math.floor((e.offsetX - L.ox) / L.cs), y = Math.floor((e.offsetY - L.oy) / L.cs);
  if (x < 0 || y < 0 || x >= run.W || y >= run.H) return;
  const cell = y * run.W + x;
  const nb = G.neighbours(run, run.p.cell).find(n => n.cell === cell);
  if (!nb) return;
  if (decoyArmed) { decoyArmed = false; doAction({ type: 'decoy', cell }); }
  else doAction({ type: 'move', dir: nb.d });
});

// ---------- buttons ----------
$('btn-new').addEventListener('click', () => { audio.resume(); clearSave(); newRun(); });
$('btn-continue').addEventListener('click', () => { audio.resume(); tryContinue(); });
$('btn-settings').addEventListener('click', () => { buildSettings(); show('settings'); });
$('btn-how').addEventListener('click', () => show('how'));
document.querySelector('.close-how').addEventListener('click', () => show(run ? 'play' : 'title'));
document.querySelector('.close-settings').addEventListener('click', () => show(run ? 'play' : 'title'));
$('btn-again').addEventListener('click', () => { clearSave(); newRun(); });
$('btn-menu').addEventListener('click', () => { audio.droneStop(); show('title'); refreshTitle(); });
$('btn-resume').addEventListener('click', () => show('play'));
$('btn-pause-settings').addEventListener('click', () => { buildSettings(); show('settings'); });
$('btn-restart').addEventListener('click', () => { clearSave(); audio.droneStop(); show('title'); refreshTitle(); });

function refreshTitle() {
  const hasSave = !!localStorage.getItem(SAVE);
  $('btn-continue').classList.toggle('hidden', !hasSave);
  const best = load(BEST, 0);
  $('bestline').textContent = best > 0 ? `deepest descent — depth ${best}` : 'the dark has not learned you yet';
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('load', () => renderer.resize());

// ---------- main loop ----------
function frame() {
  if (run && screenName !== 'title') {
    // simple smoothing for the player token
    const k = settings.reducedMotion ? 1 : 0.35;
    v.dx = v.dx === undefined ? v.pfx : v.dx + (v.pfx - v.dx) * k;
    v.dy = v.dy === undefined ? v.pfy : v.dy + (v.pfy - v.dy) * k;
    renderer.draw(run, v);
  } else {
    renderer.ctx && renderer.ctx.clearRect(0, 0, renderer.w, renderer.h);
  }
  requestAnimationFrame(frame);
}

applySettings();
refreshTitle();
show('title');
frame();
