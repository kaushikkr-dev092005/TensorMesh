import express from 'express';
import { ExpressPeerServer } from 'peer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { portableServer } from '../tensormesh/scripts/serve-portable.mjs';
import { generateRoomInvite } from '../room/invite.js';
import { turnIssuer } from './turn-config.mjs';

// One origin for the website and owned discovery; TLS is supplied by the host's reverse proxy.
export async function startGateway({ origin, port = 1421, directory = fileURLToPath(new URL('../tensormesh/dist/', import.meta.url)), turnEnvironment = process.env } = {}) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) throw new Error('Use an HTTPS TensorMesh origin without a path');
  const config = { publicOrigin: origin, signal: origin.replace(/^https:/, 'wss:') + '/tensormesh' };
  generateRoomInvite('ABCD', { origin, signal: config.signal });
  const server = portableServer(directory);
  const staticHandler = server.listeners('request')[0];
  server.removeAllListeners('request');
  const app = express();
  const issueTurn = turnIssuer(turnEnvironment);
  server.on('request', app);
  const discovery = ExpressPeerServer(server, { path: '/', key: 'tensormesh', allow_discovery: false, alive_timeout: 30000, expire_timeout: 5000 });
  app.get('/health', (_req, res) => res.json({ service: 'TensorMesh gateway' }));
  app.get('/api/ice', (_req, res) => res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).json(issueTurn()));
  app.get('/runtime/tensormesh-config.json', (_req, res) => res.set('Cache-Control', 'no-store').json(config));
  app.get('/runtime/tensormesh-config.js', (_req, res) => res.set('Cache-Control', 'no-store').type('application/javascript').send(
    `window.TENSORMESH_SIGNAL_SERVERS=${JSON.stringify([config.signal])};window.TENSORMESH_PUBLIC_ORIGIN=${JSON.stringify(origin)};`
  ));
  app.use('/tensormesh', discovery);
  app.use(staticHandler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, config, port: server.address().port };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const running = await startGateway({ origin: process.env.TENSORMESH_PUBLIC_ORIGIN });
  console.log(`TensorMesh gateway: loopback port ${running.port}, public origin ${running.config.publicOrigin}`);
}
