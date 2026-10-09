import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createRoom, generateRoomInvite, parseRoomInvite, ROOM_PREFIX } from '../room/invite.js';

const origin = process.argv[2];
const configResponse = await fetch(origin + '/runtime/tensormesh-config.json');
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(config.publicOrigin, origin);
assert.equal(config.signal, origin.replace(/^https:/, 'wss:') + '/tensormesh');
const room = createRoom({ signal: config.signal });
const invite = generateRoomInvite(room.roomId, { origin, signal: config.signal });
assert.equal(parseRoomInvite(invite).signal, config.signal);
assert.doesNotMatch(invite, /localhost|127\.0\.0\.1|pooled/);
assert.equal((await fetch(invite)).status, 200);
const sockets = [];
function message(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Public signaling timed out: ' + type)), 20000);
    socket.on('error', reject);
    socket.on('message', data => {
      const value = JSON.parse(data);
      if (value.type === type) { clearTimeout(timeout); resolve(value); }
    });
  });
}
async function register(id) {
  const socket = new WebSocket(`${config.signal}/peerjs?key=tensormesh&id=${id}&token=${crypto.randomUUID()}`);
  sockets.push(socket);
  await message(socket, 'OPEN');
  return socket;
}
let failed = false;
try {
  const host = await register(ROOM_PREFIX + room.roomId);
  const guest = await register('tensormesh-probe-' + crypto.randomUUID());
  const offer = message(host, 'OFFER');
  guest.send(JSON.stringify({ type: 'OFFER', dst: ROOM_PREFIX + room.roomId, payload: { connectionId: 'probe', type: 'data', sdp: { type: 'offer', sdp: 'signaling probe only' } } }));
  assert.equal((await offer).dst, ROOM_PREFIX + room.roomId);
  console.log('PASS public HTTPS room route and real WSS registration/offer forwarding through TensorMesh gateway');
  console.log('This is a signaling probe, not cross-network GPU inference.');
} catch (error) { failed = true; console.error(error); }
finally { for (const socket of sockets) socket.terminate(); }
setTimeout(() => process.exit(failed ? 1 : 0), 100);
