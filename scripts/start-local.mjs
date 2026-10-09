import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { portableServer } from '../tensormesh/scripts/serve-portable.mjs';
import { startSignal } from './tensormesh-signal.mjs';

const directory = fileURLToPath(new URL('../tensormesh/dist/', import.meta.url));
await access(new URL('../tensormesh/dist/index.html', import.meta.url));
const signal = await startSignal();
const web = portableServer(directory);
try {
  await new Promise((resolve, reject) => {
    web.once('error', reject);
    web.listen(1420, '127.0.0.1', resolve);
  });
} catch (error) {
  signal.server.close();
  console.error(error.message);
  process.exit(1);
}
console.log('TensorMesh: http://localhost:1420 (own signaling on port 9000)');
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => {
  web.close();
  signal.server.close();
  process.exit(0);
});
