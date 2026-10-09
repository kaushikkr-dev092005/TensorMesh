// Actual TensorMesh UI + self-hosted discovery + WebRTC. No model is loaded.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startSignal} from '../../scripts/tensormesh-signal.mjs';
import {portableServer} from '../../tensormesh/scripts/serve-portable.mjs';
import {loadPlaywright,chromiumPath} from './engine_synth.mjs';
const discovery=await startSignal();
const web=portableServer(fileURLToPath(new URL('../../tensormesh/dist',import.meta.url)));
await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(1420,'127.0.0.1',resolve);});
let browser,failed=false;
try {
  const {chromium}=await loadPlaywright();
  browser=await chromium.launch({executablePath:chromiumPath(),headless:true,args:['--enable-unsafe-webgpu']});
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const forbidden=[];
  context.on('request',req=>{if(/pooled|0\.peerjs\.com/.test(req.url()))forbidden.push(req.url());});
  const host=await context.newPage();
  await host.goto('http://localhost:1420');
  await host.getByRole('button',{name:/Create a room/}).click();
  const room=host.frameLocator('iframe[title="TensorMesh shared GPU room and chat"]');
  await room.locator('body.in-room').waitFor({timeout:45000});
  await room.locator('#share-btn').click();
  const invite=await room.locator('#share-url').textContent();
  assert.match(invite,/^http:\/\/localhost:1420\/room\/[A-Z2-9]{4}\?/);
  assert.doesNotMatch(invite,/pooled/i);
  await room.locator('#share-copy').click();
  assert.equal(await host.evaluate(()=>navigator.clipboard.readText()),invite);
  const guest=await context.newPage();
  await guest.goto(invite);
  const guestRoom=guest.frameLocator('iframe[title="TensorMesh shared GPU room and chat"]');
  await guestRoom.locator('body.in-room').waitFor({timeout:45000});
  assert.equal(await guestRoom.locator('#room-badge').textContent(),await room.locator('#room-badge').textContent());
  assert.equal(forbidden.length,0,forbidden.join('\n'));
  const invalid=await context.newPage();
  await invalid.goto(invite.replace(/expires=\d+/,'expires=1'));
  await invalid.getByRole('status').filter({hasText:/expired/}).waitFor();
  assert.equal(await invalid.locator('iframe').count(),0);
  console.log('PASS TensorMesh Create → Invite → Copy → browser route → real WebRTC join; expired invite rejected; no Pooled/cloud requests');
}catch(error){failed=true;console.error(error);}
finally {
  await browser?.close();
  await new Promise(resolve=>web.close(resolve));
  await new Promise(resolve=>discovery.server.close(resolve));
}
process.exit(failed?1:0);
