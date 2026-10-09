import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { turnIssuer } from '../scripts/turn-config.mjs';
import { deploymentTurn, iceConfig, shareQuery } from '../room/ice.js';

test('gateway issues expiring coturn credentials without exposing the shared secret', () => {
  const env = { TENSORMESH_TURN_URLS: 'turns:relay.example:443?transport=tcp', TENSORMESH_TURN_SECRET: 'server-only-fixture' };
  const data = turnIssuer(env)();
  const server = data.iceServers[0];
  assert.equal(server.credential, createHmac('sha1', env.TENSORMESH_TURN_SECRET).update(server.username).digest('base64'));
  assert.ok(data.expiresAt > Date.now());
  assert.ok(data.expiresAt <= Date.now() + 3600_000);
  assert.ok(!JSON.stringify(data).includes(env.TENSORMESH_TURN_SECRET));
  assert.deepEqual(turnIssuer({})().iceServers, []);
  assert.throws(() => turnIssuer({ TENSORMESH_TURN_URLS: 'https://invalid' }));
  assert.throws(() => turnIssuer({ TENSORMESH_TURN_URLS: 'turn:relay.example:3478' }));
});

test('clients retrieve fresh credentials from their own signaling origin and pass them to WebRTC', async () => {
  const issuer = turnIssuer({ TENSORMESH_TURN_URLS: 'turns:relay.example:443?transport=tcp', TENSORMESH_TURN_SECRET: 'fixture' });
  let requests = 0;
  const fetcher = async (url) => {
    assert.equal(url, 'https://mesh.example/api/ice'); requests++;
    return Response.json(issuer());
  };
  const first = await deploymentTurn('wss://mesh.example/tensormesh', fetcher);
  const second = await deploymentTurn('wss://mesh.example/tensormesh', fetcher);
  assert.equal(requests, 2);
  assert.notEqual(first[0].username, second[0].username);
  assert.deepEqual(iceConfig(null, first).iceServers[1], first[0]);
  assert.equal(shareQuery('turn=x&turncred=secret&turnuser=u&room=ABCD').toString(), 'room=ABCD');
});

test('expired, malformed and unavailable relay config is rejected', async () => {
  for (const data of [{}, { iceServers: [{ urls: 'turn:x:3478' }], expiresAt: 0 }, { iceServers: [{ urls: 'https://x' }], expiresAt: Date.now() + 10000 }]) {
    await assert.rejects(deploymentTurn('wss://mesh.example/tensormesh', async () => Response.json(data)));
  }
  await assert.rejects(deploymentTurn('wss://mesh.example/tensormesh', async () => new Response('', { status: 503 })));
  assert.deepEqual(await deploymentTurn('wss://mesh.example/tensormesh', async () => new Response('', { status: 404 })), []);
});
