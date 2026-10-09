import {mkdir,cp,writeFile} from 'node:fs/promises';
await mkdir('dist/audit/external/tslib',{recursive:true});
for(const file of ['core.js','external/tslib/tslib.es6.js'])await cp('node_modules/@tauri-apps/api/'+file,'dist/audit/'+file);
await writeFile('dist/audit.html','<!doctype html><meta charset="utf-8"><h1>TensorMesh native preview audit</h1><pre id="results">Starting</pre><div id="preview" style="height:240px;width:600px"></div><script type="module" src="/audit/run.js"></script>');
await writeFile('dist/audit/run.js', String.raw`import {invoke,transformCallback} from './core.js';
import {mountPreview} from '/runtime/harness/preview-frame.js';
const output=document.getElementById('results');output.textContent='';
function log(value){output.textContent+=JSON.stringify(value)+'\n';}
let view;
try{
const origin=await invoke('preview_host');
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Invalid relay origin');
log({command:'preview_host',pass:true,origin});
let received;const ipcOutcome=new Promise(r=>received=r);const accepted=transformCallback(v=>received({accepted:true,result:v}),true);const deniedCallback=transformCallback(e=>received({accepted:false,error:String(e)}),true);
const html='<h1>Generated preview</h1><script>console.log("AUDIT_PREVIEW_RAN");try{parent.document.body;console.log("AUDIT_PARENT_EXPOSED")}catch{console.log("AUDIT_PARENT_ISOLATED")}if(typeof window.__TAURI_INTERNALS__==="undefined"){console.log("AUDIT_NO_IPC")}else{window.__TAURI_INTERNALS__.postMessage({cmd:"devices",callback:'+accepted+',error:'+deniedCallback+',payload:{}})}</script>';
const files=new Map([['index.html',{bytes:new TextEncoder().encode(html),type:'text/html'}]]);
const source={snapshot:()=>({entry:'index.html',files,rev:1}),onUpdate:()=>()=>{},attach:()=>()=>{}};
const markers=new Set();let resolve;const done=new Promise(r=>resolve=r);
view=mountPreview(document.getElementById('preview'),source,8080,{relay:origin+'/harness/preview-relay.html',onLog:e=>{log({previewLog:e.text});markers.add(e.text);if(markers.has('AUDIT_PREVIEW_RAN')&&markers.has('AUDIT_PARENT_ISOLATED'))resolve();},onStatus:e=>log({status:e.state})});
await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Preview timeout: '+[...markers])),10000))]);
if(markers.has('AUDIT_PARENT_EXPOSED')||markers.has('AUDIT_IPC_ACCEPTED'))throw Error('Isolation failure');
log({preview:true,pass:true,markers:[...markers]});
const outcome=await Promise.race([ipcOutcome,new Promise(r=>setTimeout(()=>r({status:'NOT VERIFIED',reason:'Frame IPC fallback produced no native response'}),3000))]);log({ipcOutcome:outcome});if(outcome.accepted)throw Error('Untrusted preview called native devices');if(outcome.error&&!/not allowed|denied|permission/i.test(outcome.error))throw Error('Unexpected rejection');
let violation;const denied=new Promise(r=>violation=r);const listener=e=>{if(e.violatedDirective.startsWith('connect-src'))violation(e.blockedURI)};
document.addEventListener('securitypolicyviolation',listener);
try{let failed=false;try{await fetch(origin+'/harness/preview-relay.html')}catch{failed=true}if(!failed)throw Error('Main HTTP fetch unexpectedly allowed');const blocked=await Promise.race([denied,new Promise((_,reject)=>setTimeout(()=>reject(Error('No CSP violation evidence')),3000))]);log({mainConnectDenied:true,blocked});}finally{document.removeEventListener('securitypolicyviolation',listener)}
log({complete:true,failures:0,ipcIsolation:outcome.error?'denied':'NOT VERIFIED'});
}catch(error){log({complete:true,failures:1,error:String(error)})}finally{view?.destroy()}
`);
console.log('Temporary native preview audit generated. Run using the main window capability; no model inference is simulated.');
