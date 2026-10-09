import { parseRoomInvite, validateRoomId } from '../../../room/invite.js';
export { createRoom, generateRoomInvite, parseRoomInvite, joinRoom, validateRoomId, validateSignal } from '../../../room/invite.js';
export function roomCode(input:string):string {
 try { return validateRoomId(input); } catch {}
 try { return parseRoomInvite(input).roomId; } catch { return ''; }
}
export function invitationSignal(input:string):string {
 try { return parseRoomInvite(input).signal; } catch { return ''; }
}
export async function roomConfig():Promise<{signal:string;publicOrigin:string}> {
 const response=await fetch('/runtime/tensormesh-config.json');
 if(!response.ok)throw new Error('TensorMesh room configuration unavailable');
 return response.json();
}
