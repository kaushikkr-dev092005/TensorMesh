import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {validateSignal, generateRoomInvite} from '../../room/invite.js';
import {assertStandaloneAssets} from './assert-standalone.mjs';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '..');
const dest = path.join(app, 'public/runtime');
if (!dest.startsWith(app + path.sep) || path.basename(dest) !== 'runtime') throw new Error('Invalid generated runtime directory');
await rm(dest, {recursive:true, force:true});
await mkdir(dest, { recursive: true });
for (const file of ['p2p.html','room.js','room','engine','harness','site','favicon.svg','site.webmanifest','apple-touch-icon.png']) await cp(path.join(repo, file), path.join(dest, file), { recursive: true });
await cp(path.join(app,'node_modules/peerjs/dist/peerjs.min.js'),path.join(dest,'peerjs.min.js'));
// The copied manifest belongs to the bundled runtime, not the server root.
const manifestPath = path.join(dest, 'site.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.name = manifest.short_name = 'TensorMesh';
for (const icon of manifest.icons) {
  if (icon.src.startsWith('/')) icon.src = '/runtime' + icon.src;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
let html = await readFile(path.join(dest,'p2p.html'),'utf8');
html = html.replace(/(href|src)="\/(?!\/)/g, '$1="/runtime/').replace('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js','/runtime/peerjs.min.js');
await cp(path.join(app,'scripts/desktop-diagnostics.js'),path.join(dest,'desktop-diagnostics.js'));
html=html.replace('<script type="module"', '<script src="/runtime/desktop-diagnostics.js"></script><script type="module"');
html=html.replace('<title>pooled', '<title>TensorMesh').replace('aria-label="pooled home"','aria-label="TensorMesh home"').replaceAll('<span>pooled</span>','<span>TensorMesh</span>').replace('href="/runtime/"','href="/" target="_top"');
let index=0; const scripts=[];
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_,source) => { const name=`bootstrap-${index++}.js`; scripts.push([name,source]); return `<script src="/runtime/${name}"></script>`; });
await writeFile(path.join(dest,'p2p.html'),html);
for(const [name,source] of scripts) await writeFile(path.join(dest,name),source);

// TensorMesh discovery, with no public signaling fallback.
const signal = validateSignal(process.env.TENSORMESH_SIGNAL_URL || 'ws://127.0.0.1:9000/tensormesh');
const publicOrigin = process.env.TENSORMESH_PUBLIC_ORIGIN || 'http://localhost:1420';
generateRoomInvite('ABCD',{signal,origin:publicOrigin}); // validate deployment configuration before packaging
await writeFile(path.join(dest,'tensormesh-config.json'), JSON.stringify({signal,publicOrigin}));
await writeFile(path.join(dest,'tensormesh-config.js'), 'window.TENSORMESH_SIGNAL_SERVERS='+JSON.stringify([signal])+';window.TENSORMESH_PUBLIC_ORIGIN='+JSON.stringify(publicOrigin)+';');
const pagePath=path.join(dest,'p2p.html');
await writeFile(pagePath,(await readFile(pagePath,'utf8')).replace('<script src="/runtime/desktop-diagnostics.js">','<script src="/runtime/tensormesh-config.js"></script><script src="/runtime/desktop-diagnostics.js">'));
await mkdir(path.join(dest,'docs'),{recursive:true});
await cp(path.join(repo,'docs/tensormesh-rooms.md'),path.join(dest,'docs/tensormesh-rooms.md'));
const roomPath=path.join(dest,'room.js');
await writeFile(roomPath,(await readFile(roomPath,'utf8')).replace('a.href = "/docs/tensormesh-rooms.md";', 'a.href = "/runtime/docs/tensormesh-rooms.md";').replace('location.href = logoLink.href;', "window.parent.postMessage({type:'tensormesh:leave'},location.origin);"));

// Font URLs must resolve inside the packaged runtime as well.
const fontsPath = path.join(dest, 'site/css/fonts.css');
await writeFile(fontsPath, (await readFile(fontsPath, 'utf8')).replaceAll('/site/fonts/', '/runtime/site/fonts/'));

// Use the native read-only HTTP relay, an origin with no Tauri IPC capability.
const previewFramePath = path.join(dest, 'harness/preview-frame.js');
await writeFile(previewFramePath, (await readFile(previewFramePath, 'utf8')).replace("const meta = doc.querySelector?.('meta[name=\"preview-origin\"]')?.content;", "const meta = new URLSearchParams(loc.search).get('desktoppreview') || doc.querySelector?.('meta[name=\"preview-origin\"]')?.content;"));

// Fail packaging before Tauri embeds any legacy hosted runtime.
await assertStandaloneAssets(dest);
