// TensorMesh owns routing and discovery; inference and WebRTC framing are unchanged.
export const ROOM_PREFIX = 'tensormesh-room-';
const CODE = /^[A-HJKMNP-TV-Z2-9]{4,6}$/;
export function validateRoomId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  if (!CODE.test(id)) throw new Error('Invalid TensorMesh room ID');
  return id;
}
export function validateSignal(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('Configure a TensorMesh signaling URL'); }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || /pooled|peerjs\.com/i.test(u.href)) throw new Error('Use your own TensorMesh signaling server');
  if (['ws:', 'http:'].includes(u.protocol) && !(['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost'))) throw new Error('Remote signaling requires TLS');
  if (u.pathname !== '/tensormesh' && u.pathname !== '/tensormesh/') throw new Error('TensorMesh signaling must use /tensormesh');
  u.pathname = '/tensormesh';
  return u.href;
}
export function generateRoomInvite(roomId, {signal, origin = '', expires = Date.now() + 86400000} = {}) {
  const id = validateRoomId(roomId);
  const endpoint = validateSignal(signal);
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new Error('Room invite expired');
  let u;
  if (origin) {
    u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || /pooled/i.test(u.href) || u.origin === 'http://tauri.localhost') throw new Error('Configure your TensorMesh browser origin');
    if (u.protocol === 'http:' && !(['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost'))) throw new Error('Remote browser invites require HTTPS');
    u = new URL('/room/' + id, u.origin);
  } else u = new URL('tensormesh://room/' + id);
  u.searchParams.set('signal', endpoint);
  u.searchParams.set('expires', String(expires));
  return u.href;
}
export function parseRoomInvite(input, {signal = '', now = Date.now()} = {}) {
  const text = String(input ?? '').trim();
  if (CODE.test(text.toUpperCase())) return {roomId: validateRoomId(text), signal: validateSignal(signal), expires: null};
  let u;
  try { u = new URL(text); } catch { throw new Error('Malformed TensorMesh invite'); }
  if (u.username || u.password || u.hash || /pooled/i.test(u.href)) throw new Error('Not a TensorMesh invite');
  const desktop = u.protocol === 'tensormesh:' && u.hostname === 'room';
  const browser = ['http:', 'https:'].includes(u.protocol);
  const match = (desktop ? /^\/([A-Z0-9]{4,6})\/?$/i : /^\/room\/([A-Z0-9]{4,6})\/?$/i).exec(u.pathname);
  if ((!desktop && !browser) || !match) throw new Error('Not a TensorMesh room URL');
  if (browser && u.protocol === 'http:' && !(['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost'))) throw new Error('Remote browser invites require HTTPS');
  for (const key of u.searchParams.keys()) if (!['signal','expires'].includes(key) || u.searchParams.getAll(key).length !== 1) throw new Error('Unexpected invite fields');
  const expiryText = u.searchParams.get('expires');
  const expires = expiryText === null ? null : Number(expiryText);
  if (expires !== null && (!/^\d+$/.test(expiryText) || !Number.isSafeInteger(expires) || expires <= now)) throw new Error('Room invite expired or invalid');
  return {roomId: validateRoomId(match[1]), signal: validateSignal(u.searchParams.get('signal') || signal), expires};
}
export function createRoom({signal, random = crypto.getRandomValues.bind(crypto)} = {}) {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = random(new Uint8Array(4));
  return {roomId: Array.from(bytes, b => alphabet[b % alphabet.length]).join(''), signal: validateSignal(signal)};
}
export async function joinRoom(invite, {signal, connect, now} = {}) {
  const parsed = parseRoomInvite(invite, {signal, now});
  if (typeof connect !== 'function') throw new Error('TensorMesh connector unavailable');
  return connect(ROOM_PREFIX + parsed.roomId, parsed);
}
