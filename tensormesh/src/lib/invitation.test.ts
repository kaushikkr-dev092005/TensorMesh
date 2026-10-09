import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomCode,invitationSignal,generateRoomInvite} from './invitation.ts';
const signal='ws://127.0.0.1:9000/tensormesh';
test('TensorMesh extraction rejects legacy destinations',()=>{
 assert.equal(roomCode(' k7qx '),'K7QX');
 assert.equal(roomCode(generateRoomInvite('ABCD',{signal,origin:'https://mesh.example'})),'ABCD');
 for(const bad of ['https://pooled.invalid/r/ABCD','javascript:alert(1)','IO01','https://example.com/?code=JK23'])assert.equal(roomCode(bad),'');
});
test('only validated discovery survives parsing',()=>{
 const invite=generateRoomInvite('ABCD',{signal,origin:'https://mesh.example'});
 assert.equal(invitationSignal(invite),signal);
 assert.equal(invitationSignal(invite+'&password=secret'),'');
});
