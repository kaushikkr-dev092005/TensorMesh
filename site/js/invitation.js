import {parseRoomInvite} from '../../room/invite.js';
export function invitationCode(value, base=globalThis.location?.href){try {return parseRoomInvite(value,{signal:new URL('/tensormesh',base).href}).roomId;}catch{return '';}}
