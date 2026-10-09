import assert from 'node:assert/strict';
import { startGateway } from '../scripts/start-gateway.mjs';
import { generateRoomInvite, parseRoomInvite } from '../room/invite.js';
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('remote gateway serves HTTPS/WSS configuration and room route from one own origin', async () => {
  const running = await startGateway({ origin: 'https://mesh.example', port: 0 });
  try {
    const local = `http://127.0.0.1:${running.port}`;
    assert.deepEqual(await (await fetch(local + '/runtime/tensormesh-config.json')).json(), {
      publicOrigin: 'https://mesh.example', signal: 'wss://mesh.example/tensormesh'
    });
    const bootstrap = await (await fetch(local + '/runtime/tensormesh-config.js')).text();
    assert.doesNotMatch(bootstrap, /localhost|127\.0\.0\.1|pooled/);
    const invite = generateRoomInvite('ABCD', { origin: running.config.publicOrigin, signal: running.config.signal });
    assert.equal(parseRoomInvite(invite).signal, 'wss://mesh.example/tensormesh');
    assert.equal((await fetch(local + '/room/ABCD')).status, 200);
    assert.equal((await fetch(local + '/tensormesh/tensormesh/id')).status, 200);
  } finally {
    running.server.closeAllConnections();
    await new Promise(resolve => running.server.close(resolve));
  }
});

test('gateway rejects loopback and legacy public origins', async () => {
  for (const origin of ['http://localhost:1420', 'https://pooled.invalid', 'https://mesh.example/path']) {
    await assert.rejects(startGateway({ origin, port: 0 }));
  }
});

test('gateway serves fresh relay credentials without its shared secret', async () => {
  const running = await startGateway({ origin: 'https://mesh.example', port: 0,
    turnEnvironment: { TENSORMESH_TURN_URLS: 'turns:relay.example:443?transport=tcp', TENSORMESH_TURN_SECRET: 'gateway-fixture-secret' } });
  try {
    const response = await fetch(`http://127.0.0.1:${running.port}/api/ice`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.iceServers.length, 1);
    assert.ok(data.expiresAt > Date.now());
    assert.ok(!JSON.stringify(data).includes('gateway-fixture-secret'));
  } finally {
    running.server.closeAllConnections();
    await new Promise(resolve => running.server.close(resolve));
  }
});

let failed = false;
for (const { name, run } of cases) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failed = true; console.error(error); }
}
// ExpressPeerServer owns housekeeping timers even after its HTTP server closes.
setTimeout(() => process.exit(failed ? 1 : 0), 100);
