import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { generateRoomInvite, parseRoomInvite } from '../room/invite.js';
import { assertStandaloneText } from '../tensormesh/scripts/assert-standalone.mjs';

test('packaging rejects stale runtime service URLs and upstream repository links', () => {
  const legacy = ['https://pooled', 'run/r/ABCD'].join('.');
  assert.throws(() => assertStandaloneText(legacy, 'runtime/room.js'), /Legacy hosted service/);
  assert.throws(() => assertStandaloneText('https://github.com/Nehanth/pooled', 'runtime/p2p.html'), /Upstream repository/);
  assert.doesNotThrow(() => assertStandaloneText('http://localhost:1420/room/ABCD', 'runtime/room.js'));
});

test('local TensorMesh invitations round-trip on the local website', () => {
  const invite = generateRoomInvite('K7QX', { origin: 'http://localhost:1420', signal: 'ws://127.0.0.1:9000/tensormesh' });
  assert.equal(new URL(invite).origin, 'http://localhost:1420');
  assert.equal(new URL(invite).pathname, '/room/K7QX');
  assert.equal(parseRoomInvite(invite).roomId, 'K7QX');
  assert.doesNotMatch(invite, /pooled|github/i);
});

test('landing and room UIs have no upstream repository control', async () => {
  for (const file of ['index.html', 'p2p.html', 'tensormesh/src/App.tsx']) {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /github\.com|id="gh-link"|data-stars|built on Pooled/);
  }
});

test('standalone source never names the legacy hosted service', async () => {
  const banned = ['pooled', 'run'].join('.');
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'target', 'dist', 'public'].includes(entry.name)) continue;
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await scan(file);
      else if (/\.(js|mjs|ts|tsx|html|css|md|txt|json|lock|toml|rs|svg|cff|yml|yaml|sh|webmanifest)$/.test(entry.name)) {
        assert.equal((await readFile(file, 'utf8')).includes(banned), false, file.pathname);
      }
    }
  }
  await scan(new URL('../', import.meta.url));
});

test('both supplied effects cancel their animation and remove canvas listeners', async () => {
  const callbacks = new Map(); let sequence = 0;
  const original = Object.fromEntries(['window', 'requestAnimationFrame', 'cancelAnimationFrame'].map(k => [k, globalThis[k]]));
  const listeners = new Map();
  const surface = { addEventListener(k, fn) { listeners.set(k, fn); }, removeEventListener(k, fn) { if(listeners.get(k) === fn) listeners.delete(k); } };
  globalThis.window = { ...surface, devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = fn => { callbacks.set(++sequence, fn); return sequence; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  try {
    for (const [file, name] of [['elikas-vortex', 'ElikasVortex'], ['plekto-lace', 'PlektoLace']]) {
      const { [name]: Effect } = await import(`../tensormesh/src/effects/${file}.js`);
      const canvas = { ...surface, style: {}, getContext: () => ({ setTransform() {} }), getBoundingClientRect: () => ({ width: 400, height: 300 }) };
      const effect = new Effect(canvas);
      effect.start(); effect.start(); assert.equal(callbacks.size, 1);
      effect.stop(); assert.equal(callbacks.size, 0);
      effect.start(); assert.equal(callbacks.size, 1);
      effect.destroy(); assert.equal(callbacks.size, 0); assert.equal(listeners.size, 0);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) { if(value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
