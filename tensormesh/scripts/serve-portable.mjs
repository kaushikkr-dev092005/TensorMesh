import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function portableServer(directory=path.resolve('dist')) {
const root=path.resolve(directory);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.wasm':'application/wasm','.ico':'image/x-icon'};
return createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p==='/' || /^\/room\/[A-Za-z0-9]{4,6}\/?$/.test(p))p='/index.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR'){res.writeHead(404).end('Not found');}else{console.error('Preview request failed', error);res.writeHead(500).end('Internal server error');}}});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)portableServer().listen(1420,'127.0.0.1',()=>console.log('TensorMesh preview: http://localhost:1420')); 
