const status = document.getElementById('join-status');
const report = message => { if(status) status.textContent = `Room runtime could not start: ${message}`; };
window.addEventListener('error',event=>report(event.message || 'a bundled module failed to load'));
window.addEventListener('unhandledrejection',event=>report(event.reason?.message || String(event.reason)));

// The shell's Create action is explicit; wait for the engine to attach its handlers.
if(new URLSearchParams(location.search).get('desktopcreate')==='1') {
 let attempts=0;
 const timer=setInterval(()=>{
   if(window.tensormeshWired){clearInterval(timer);if(!document.body.classList.contains('in-room'))document.getElementById('create-btn')?.click();}
   else if(++attempts>100){clearInterval(timer);report('initialization timed out. Reload the workspace and try again.');}
 },100);
}
