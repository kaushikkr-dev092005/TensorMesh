import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoom,generateRoomInvite,parseRoomInvite,joinRoom,validateSignal,validateRoomId,ROOM_PREFIX} from '../room/invite.js';
import {serverList} from '../room/signal.js';
const signal='ws://127.0.0.1:9000/tensormesh';
test('TensorMesh creates valid IDs and generates only minimal native invites',()=>{
  const room=createRoom({signal});
  const invite=generateRoomInvite(room.roomId,{signal,origin:'https://mesh.example'});
  assert.match(invite,/^https:\/\/mesh\.example\/room\/[A-Z2-9]{4}\?/);
  assert.doesNotMatch(invite,/pooled/i);
  assert.deepEqual([...new URL(invite).searchParams.keys()],['signal','expires']);
  assert.equal(parseRoomInvite(invite).roomId,room.roomId);
  const expires=Date.now()+86400000;
  assert.equal(generateRoomInvite(room.roomId,{signal,origin:'https://mesh.example',expires}),generateRoomInvite(room.roomId,{signal,origin:'https://mesh.example',expires}));
  for(let byte=0;byte<256;byte++) {
    const generated=createRoom({signal,random:bytes=>bytes.fill(byte)});
    assert.equal(validateRoomId(generated.roomId),generated.roomId);
  }
});
test('browser and desktop parsing and valid join target TensorMesh namespace',async()=>{
  for(const origin of ['https://mesh.example','']) {
    const invite=generateRoomInvite('K7QX',{signal,origin});
    let target;
    await joinRoom(invite,{connect:(peerId,parsed)=>{target=peerId;assert.equal(parsed.signal,signal);}});
    assert.equal(target,ROOM_PREFIX+'K7QX');
  }
  assert.equal(parseRoomInvite(' k7qx ',{signal}).roomId,'K7QX');
});
test('malformed, expired and legacy invites fail before connecting',async()=>{
  const good=generateRoomInvite('ABCD',{signal,origin:'https://mesh.example'});
  for(const bad of ['IO01','javascript:alert(1)','https://pooled.invalid/r/ABCD','https://pooled.invalid/room/ABCD?signal='+signal,good+'&redirect=https://pooled.invalid',good.replace('/ABCD','/AAAAAAA'),good.replace(/expires=\d+/,'expires=1'),good+'&signal='+signal]) {
    let connected=false;
    await assert.rejects(joinRoom(bad,{signal,connect:()=>{connected=true;}}));
    assert.equal(connected,false);
  }
});
test('signaling never falls back to cloud or a legacy service',()=>{
  assert.throws(()=>serverList());
  for(const bad of ['cloud','wss://0.peerjs.com/tensormesh','wss://pooled.invalid/tensormesh','ws://mesh.example/tensormesh']) {
    assert.throws(()=>validateSignal(bad));
    assert.throws(()=>serverList({query:bad,configured:[signal]}));
  }
  assert.equal(serverList({configured:[signal]})[0].opts.key,'tensormesh');
});
test('build and navigation code contain no Pooled redirect',async()=>{
  const build=await readFile(new URL('../tensormesh/scripts/sync-runtime.mjs',import.meta.url),'utf8');
  const connect=await readFile(new URL('../site/js/connect.js',import.meta.url),'utf8');
  assert.doesNotMatch(build,/https:\/\/pooled/);
  assert.match(connect,/location\.assign\(generateRoomInvite/);
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(config.redirects,[]);
  assert.ok(config.rewrites.some(r=>r.source==='/room/:code'));
  assert.equal(await readFile(new URL('../cli/lib/invite.js',import.meta.url),'utf8'),await readFile(new URL('../room/invite.js',import.meta.url),'utf8'),'standalone CLI parser must match the browser parser');
});

test('generated loopback browser invites round-trip without allowing remote plaintext',()=>{
  for(const origin of ['http://localhost:1420','http://127.0.0.1:1420','http://mesh.localhost:1420','http://[::1]:1420','https://mesh.example']) {
    const invite=generateRoomInvite('ABCD',{signal,origin});
    assert.equal(parseRoomInvite(invite).roomId,'ABCD');
  }
  assert.throws(()=>parseRoomInvite('http://mesh.example/room/ABCD?signal='+encodeURIComponent(signal)),/HTTPS/);
});
