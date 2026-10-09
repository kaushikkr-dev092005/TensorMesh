import assert from 'node:assert/strict';
import {invitationCode} from '../site/js/invitation.js';
import {generateRoomInvite} from '../room/invite.js';
const base='http://localhost:1420';
const invite=generateRoomInvite('ABCD',{signal:'ws://127.0.0.1:9000/tensormesh',origin:base});
assert.equal(invitationCode(' k7qx ',base),'K7QX');
assert.equal(invitationCode(invite,base),'ABCD');
for(const bad of ['https://pooled.invalid/r/ABCD','/room?code=ABCD','javascript:alert(1)','IO01','https://evil.example/?code=ABCD'])assert.equal(invitationCode(bad,base),'');
console.log('7 TensorMesh invitation checks passed');
