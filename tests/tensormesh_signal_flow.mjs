import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {startSignal} from '../scripts/tensormesh-signal.mjs';
import {createRoom,generateRoomInvite,joinRoom,ROOM_PREFIX} from '../room/invite.js';
const service=await startSignal({port:0});
const signal=`ws://127.0.0.1:${service.port}/tensormesh`;
const sockets=[];
function message(socket,type) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('message',receive);reject(Error('Timed out waiting for '+type));},10000);
    const receive=data=>{const m=JSON.parse(data);if(m.type===type){clearTimeout(timer);socket.off('message',receive);resolve(m);}};
    socket.on('message',receive);
  });
}
async function register(id) {
  const ws=new WebSocket(`${signal}/peerjs?key=tensormesh&id=${id}&token=${crypto.randomUUID()}`);
  sockets.push(ws);
  const opened=message(ws,'OPEN');
  ws.on('error',error=>console.error('Signaling socket error',error));
  await opened;
  return ws;
}
let failed=false;
try {
  const room=createRoom({signal});
  const host=await register(ROOM_PREFIX+room.roomId);
  const invite=generateRoomInvite(room.roomId,{signal,origin:'https://mesh.example'});
  const guest=await register('tensormesh-guest-'+crypto.randomUUID());
  const received=message(host,'OFFER');
  await joinRoom(invite,{connect:peerId=>guest.send(JSON.stringify({type:'OFFER',dst:peerId,payload:{type:'data',connectionId:'test-connection',sdp:{type:'offer',sdp:'audit signaling only'}}}))});
  const offer=await received;
  assert.equal(offer.dst,ROOM_PREFIX+room.roomId);
  assert.match(offer.src,/^tensormesh-guest-/);
  const answered=message(guest,'ANSWER');
  host.send(JSON.stringify({type:'ANSWER',dst:offer.src,payload:{connectionId:'test-connection'}}));
  assert.equal((await answered).src,ROOM_PREFIX+room.roomId);
  const expired=message(guest,'EXPIRE');
  guest.send(JSON.stringify({type:'OFFER',dst:ROOM_PREFIX+'ZZZZ',payload:{connectionId:'missing-room'}}));
  assert.equal((await expired).src,ROOM_PREFIX+'ZZZZ');
  console.log('PASS real TensorMesh signaling: registration, invite join target, offer/answer relay and unavailable room expiry');
  console.log('Scope: real sockets and discovery service; SDP is a signaling fixture, not a WebRTC inference session.');
}catch(error){failed=true;console.error(error);}
finally {
  for(const socket of sockets)socket.terminate();
  await new Promise(resolve=>service.server.close(resolve));
}
// PeerServer owns long-lived expiry timers; terminate after assertions and socket/server cleanup.
process.exit(failed?1:0);
