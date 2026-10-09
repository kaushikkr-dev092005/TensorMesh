import { createHmac, randomUUID } from 'node:crypto';
import { normTurn } from '../room/ice.js';

// The coturn shared secret stays on the gateway. Only expiring credentials reach peers.
export function turnIssuer(env = process.env) {
  const urls = env.TENSORMESH_TURN_URLS;
  if (!urls) return () => ({ iceServers: [], expiresAt: null });
  const config = normTurn({ urls });
  if (!config?.urls.length || config.bad) throw new Error('Invalid TENSORMESH_TURN_URLS');
  const secret = env.TENSORMESH_TURN_SECRET;
  if (!secret) throw new Error('TENSORMESH_TURN_SECRET is required for coturn timed authentication');
  return () => {
    const expiresAt = Date.now() + 3600_000;
    const username = `${Math.floor(expiresAt / 1000)}:${randomUUID()}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return { iceServers: [{ urls: config.urls, username, credential }], expiresAt };
  };
}
