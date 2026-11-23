import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';

// DOM-free behavioral regression for Sparkco's embeddable bilingual timer.
// Run against the current file, or set TIMER_HTML to a baseline fixture.
const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = process.env.TIMER_HTML || resolve(here, '../index.html');
const html = readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'timer inline script must exist');

function mount({ now = 1000000, session = new Map() } = {}) {
  const nodes = new Map();
  const audio = { warning: 0, end: 0 };
  let currentTime = now;
  function element(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        value: id === 'minInput' ? '10' : id === 'warnInput' ? '60' : '',
        style: { display: 'none' }, textContent: '', innerText: '',
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        },
        setAttribute() {},
        play() {
          if (id === 'endSound') audio.end++;
          if (id === 'warnBeep') audio.warning++;
          return Promise.resolve();
        }
      });
    }
    return nodes.get(id);
  }
  const memory = new Map();
  const storage = (map) => ({
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); }
  });
  class FakeDate extends Date { static now() { return currentTime; } }
  const location = { href: 'https://sparkco.example/timer?room=pilot', pathname: '/timer', search: '?room=pilot' };
  const sandbox = vm.createContext({
    Date: FakeDate, URL, URLSearchParams, location, window: { location },
    sessionStorage: storage(session), localStorage: storage(memory),
    document: {
      documentElement: { lang: '', dir: '' },
      getElementById: element, querySelector: element
    },
    history: { state: null, replaceState() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout() {}
  });
  vm.runInContext(script, sandbox, { timeout: 3000 });
  return {
    audio, nodes, session,
    advance(seconds) { currentTime += seconds * 1000; },
    update() { vm.runInContext('update()', sandbox, { timeout: 3000 }); },
    restart(minutes = 1) {
      element('minInput').value = String(minutes);
      vm.runInContext('startTimer()', sandbox, { timeout: 3000 });
    },
    now: () => currentTime
  };
}

test('end sound is emitted only once even if update runs again', () => {
  const app = mount();
  app.advance(601);
  app.update();
  app.update();
  assert.equal(app.audio.end, 1);
});

test('a fresh countdown may emit its own end sound once', () => {
  const app = mount();
  app.advance(601);
  app.update();
  app.restart(1);
  app.advance(61);
  app.update();
  app.update();
  assert.equal(app.audio.end, 2);
});

test('refreshing an already finished countdown does not replay its sound', () => {
  const session = new Map();
  const first = mount({ session });
  first.advance(601);
  first.update();
  assert.equal(first.audio.end, 1);
  const second = mount({ session, now: first.now() });
  second.update();
  assert.equal(second.audio.end, 0);
});
