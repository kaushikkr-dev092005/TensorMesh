import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const legacyHost = ['pooled', 'run'].join('.');
export function assertStandaloneText(text, filename) {
  if (text.toLowerCase().includes(legacyHost)) {
    throw new Error(`Legacy hosted service found in packaged TensorMesh asset: ${filename}`);
  }
  if (/github\.com\/Nehanth\/pooled/i.test(text)) {
    throw new Error(`Upstream repository link found in packaged TensorMesh asset: ${filename}`);
  }
}

export async function assertStandaloneAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertStandaloneAssets(filename);
    else if (/\.(html|js|json|svg|css|md|webmanifest)$/.test(entry.name)) {
      assertStandaloneText(await readFile(filename, 'utf8'), filename);
    }
  }
}
