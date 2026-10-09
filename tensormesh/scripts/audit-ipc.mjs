import { mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
if (!process.argv[2]) throw new Error('Usage: node scripts/audit-ipc.mjs /absolute/path/to/header-only-fixture.gguf (GGUF v3, 7 tensors, 24 bytes)');
const fixture=path.resolve(process.argv[2]);
await mkdir('dist/audit/external/tslib',{recursive:true});
for(const file of ['core.js','event.js','external/tslib/tslib.es6.js'])await cp('node_modules/@tauri-apps/api/'+file,'dist/audit/'+file);
await writeFile('dist/audit.html','<!doctype html><html><head><meta charset="utf-8"><title>TensorMesh IPC audit</title></head><body><h1>Actual native IPC audit</h1><pre id="results">Starting</pre><script type="module" src="/audit/run.js"></script></body></html>');
await writeFile('dist/audit/run.js',`import {invoke} from './core.js';
import {listen,emit} from './event.js';
const fixture=${JSON.stringify(fixture)};
const output=document.getElementById('results');output.textContent='';
let failures=0;
function log(name,result){output.textContent+=JSON.stringify({name,...result})+'\\n';}
async function check(name,fn){try{log(name,{pass:true,result:await fn()});}catch(error){failures++;log(name,{pass:false,error:String(error)});}}
function assert(value,message){if(!value)throw Error(message);}
await check('models-before',async()=>{const m=await invoke('models');return {count:m.length,persistedFixture:m.some(v=>v.path.toLowerCase().endsWith(fixture.toLowerCase()))};});
await check('register_model',async()=>{const m=await invoke('register_model',{path:fixture});assert(m.version===3&&m.tensors===7&&m.bytes===24,'Header mismatch');return m;});
await check('register-repeat-and-models',async()=>{await invoke('register_model',{path:fixture});const m=await invoke('models');assert(m.filter(v=>v.name==='audit-header-only.gguf').length===1,'Duplicate/missing registry entry');return {count:m.length};});
await check('devices',async()=>{const d=await invoke('devices');assert(d.length>0,'No adapters');return d.map(v=>({name:v.name,backend:v.backend}));});
await check('graph_plan',async()=>{const p=await invoke('graph_plan',{hidden:5120,maxBufferMb:128});assert(p.dispatches===7&&p.alignment===256,'Invalid graph result');return p;});
await check('speculation_plan',async()=>{const p=await invoke('speculation_plan',{acceptance:.8,rttMs:10,points:[[4,12],[8,20],[16,40]]});assert(p.depth===4,'Unexpected depth');return p;});
await check('placement_plan',async()=>{const p=await invoke('placement_plan',{layerMb:[128,128,128,128],devices:[{name:'host',capacityMb:256,layerMs:[2,2,2,2],overheadMs:0},{name:'peer',capacityMb:512,layerMs:[3,3,3,3],overheadMs:0}],hopMs:[[0,5],[5,0]]});assert(p.estimatedMs===15,'Incorrect placement');return p;});
await check('gpu_probe',async()=>{const p=await invoke('gpu_probe',{iterations:3});assert(p.maxAbsError<=.001,'Parity failed');return p;});
for(const [cmd,args]of [['gpu_probe',{iterations:0}],['graph_plan',{hidden:0,maxBufferMb:128}],['speculation_plan',{acceptance:1.1,rttMs:10,points:[[4,12]]}],['placement_plan',{layerMb:[],devices:[],hopMs:[]}]])await check(cmd+'-invalid',async()=>{try{await invoke(cmd,args);}catch(e){return {rejected:String(e)};}throw Error('Invalid input accepted');});
await check('native-event-service-roundtrip',async()=>{let resolve;const received=new Promise(r=>resolve=r);const unlisten=await listen('tensormesh-audit-event',event=>resolve(event.payload));try{await emit('tensormesh-audit-event',{sequence:37});const p=await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('Event timed out')),3000))]);assert(p.sequence===37,'Event payload mismatch');return p;}finally{await unlisten();}});
await check('dialog-save-denied',async()=>{try{await invoke('plugin:dialog|save',{options:{}});}catch(e){assert(/not allowed|denied|permission/i.test(String(e)),'Unexpected rejection: '+e);return {rejected:String(e)};}throw Error('Unapproved save capability accepted');});
await check('CSP-http-connect-denied',async()=>{let resolve;const violation=new Promise(r=>resolve=r);const handler=e=>{if(e.violatedDirective.startsWith('connect-src'))resolve(e.blockedURI);};document.addEventListener('securitypolicyviolation',handler);try{let failed=false;try{await fetch('http://127.0.0.1:1420/');}catch{failed=true;}assert(failed,'Cross-origin HTTP request succeeded');return await Promise.race([violation,new Promise((_,reject)=>setTimeout(()=>reject(Error('No CSP evidence')),3000))]);}finally{document.removeEventListener('securitypolicyviolation',handler);}});
log('complete',{failures});
`);
console.log('Generated real-IPC audit page in dist. This page registers a header-only fixture; it does not load weights.');
