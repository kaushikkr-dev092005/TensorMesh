export const ROOM_PREFIX: string;
export function validateRoomId(value: unknown): string;
export function validateSignal(value: unknown): string;
export function generateRoomInvite(roomId: string, options: {signal: string; origin?: string; expires?: number}): string;
export function parseRoomInvite(input: string, options?: {signal?: string; now?: number}): {roomId: string; signal: string; expires: number|null};
export function createRoom(options: {signal: string; random?: (values: Uint8Array)=>Uint8Array}): {roomId:string; signal:string};
export function joinRoom(invite:string, options:{signal?:string; now?:number; connect:(peerId:string,parsed:ReturnType<typeof parseRoomInvite>)=>unknown}): Promise<unknown>;
