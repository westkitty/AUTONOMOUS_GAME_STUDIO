// Headless smoke test for the browser shell: stub a minimal DOM, import main.js,
// then drive boot -> new run -> a sequence of inputs -> descend, asserting no
// exception is thrown. Catches wiring bugs the node tests can't see.
let frames = 0;
const winListeners = {};

function anyProxy() {
  const f = function () { return anyProxy(); };
  return new Proxy(f, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : anyProxy()),
    apply: () => anyProxy(),
    set: () => true,
  });
}

function makeEl(id) {
  const classes = new Set();
  const listeners = {};
  const el = {
    id, dataset: {}, disabled: false, title: '', className: '', textContent: '',
    innerHTML: '', children: [],
    style: { setProperty() {}, width: '' },
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; on ? classes.add(c) : classes.delete(c); return on; },
    },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    appendChild: c => el.children.push(c),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getContext: () => anyProxy(),
    clientWidth: 900, clientHeight: 700, width: 0, height: 0,
    fire: (t, ev) => (listeners[t] || []).forEach(f => f(ev || {})),
  };
  return el;
}

const els = {};
globalThis.document = {
  getElementById: id => (els[id] ||= makeEl(id)),
  createElement: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [makeEl(), makeEl(), makeEl()],
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => { (winListeners[t] ||= []).push(f); };
globalThis.requestAnimationFrame = f => { if (frames++ < 5) f(); };
globalThis.setTimeout = (f) => 0; globalThis.clearTimeout = () => {};

const fireWindow = (t, ev) => (winListeners[t] || []).forEach(f => f(ev));

const main = await import('../src/web/main.js');
console.log('boot OK');

// start a run
els['btn-new'].fire('click');
console.log('new run OK');

// drive a bunch of inputs: moves, wait, exhale, habit, decoy-arm + move, escape pause/resume
const key = (code) => fireWindow('keydown', { code, preventDefault() {} });
const dirs = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
for (let i = 0; i < 60; i++) {
  key(dirs[i % 4]);
  if (i % 7 === 0) key('Space');
  if (i % 9 === 0) key('KeyE');
  if (i % 11 === 0) key('KeyH');
  if (i % 13 === 0) { key('KeyQ'); key(dirs[i % 4]); }
  // descend choice if the choice screen got populated
  if (els['choices'] && els['choices'].children.length) els['choices'].children[0].fire('click');
}
console.log('input drive OK');

key('Escape'); key('Escape');
console.log('pause/resume OK');
console.log('DOM SMOKE PASSED');
