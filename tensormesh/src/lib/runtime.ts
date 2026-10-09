import { invoke, isTauri } from '@tauri-apps/api/core';
export const native = isTauri();
export interface Device { name: string; backend: string; deviceType: string; maxBufferBytes: number; maxBindingBytes: number }
export interface Model { name: string; path: string; bytes: number; version: number; tensors: number }
export interface GraphPlan { dispatches: number; arenas: number[]; reservedBytes: number; nodes: string[]; alignment: number }
export interface Probe { adapter: string; backend: string; rows: number; cols: number; iterations: number; averageWallMs: number; maxAbsError: number }
export interface PlacementInput { layerMb:number[]; devices:{name:string;capacityMb:number;layerMs:number[];overheadMs:number}[]; hopMs:number[][] }
export interface PlacementResult { estimatedMs:number; stages:{device:string;firstLayer:number;endLayer:number}[] }
export const api = {
 previewHost: () => native ? invoke<string>('preview_host') : Promise.resolve(''),
 place: (input:PlacementInput) => invoke<PlacementResult>('placement_plan',input as unknown as Record<string,unknown>),
 devices: () => native ? invoke<Device[]>('devices') : Promise.resolve([]),
 models: () => native ? invoke<Model[]>('models') : Promise.resolve([]),
 register: (path: string) => invoke<Model>('register_model', { path }),
 graph: (hidden: number, maxBufferMb: number) => invoke<GraphPlan>('graph_plan', { hidden, maxBufferMb }),
 probe: (iterations: number) => invoke<Probe>('gpu_probe', { iterations }),
 speculate: (acceptance: number, rttMs: number, points: [number,number][]) => invoke<{depth:number;expectedTokens:number;tokensPerSecond:number}>('speculation_plan',{acceptance,rttMs,points}),
};
