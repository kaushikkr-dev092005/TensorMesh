import { attachChannel, makeLink, sendFrame, wireReady } from "../room/transport.js";
import { packF16, unpackF16 } from "../room/wire.js";
import { summarize } from "./hop_stats.js";

const $ = (id) => document.getElementById(id);
const status = (message) => { $("status").textContent = message; };
const report = (value) => { $("result").textContent = JSON.stringify(value, null, 2); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let endpoints = [], host = null, gpu = null, seq = 0, busy = false;
const pending = new Map();

function updateConnection() {
  const ready = host && host.pc.connectionState === "connected" &&
    wireReady(host.link) && host.control?.readyState === "open";
  $("hop").disabled = !ready || busy;
  if (ready) status("Connected. The full hop probe is ready.");
  else if (endpoints.some((e) => e.role === "echo" && e.pc.connectionState === "connected"))
    status("Worker connected. Start the hop probe on device A.");
}

function closeEndpoints() {
  for (const endpoint of endpoints) endpoint.pc.close();
  endpoints = [];
  host = null;
  for (const waiter of pending.values()) waiter.reject(new Error("connection closed"));
  pending.clear();
  updateConnection();
}

function pendingResponse(kind, id) {
  const key = `${kind}:${id}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${kind} timed out`)); }, 10000);
    pending.set(key, {
      resolve: (value) => { clearTimeout(timer); pending.delete(key); resolve(value); },
      reject: (error) => { clearTimeout(timer); pending.delete(key); reject(error); },
    });
  });
}

async function ensureGpu() {
  if (gpu) return gpu;
  if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter was found");
  const device = await adapter.requestDevice();
  const info = adapter.info;
  gpu = { device, sink: null, sinkBytes: 0, adapterInfo: info ? {
    vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
  } : null };
  device.lost.then((reason) => { gpu = null; status(`GPU device lost: ${reason.message || reason.reason}`); });
  return gpu;
}

function makeGpuReadback(device, activation) {
  const bytes = activation.byteLength;
  const source = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  device.queue.writeBuffer(source, 0, activation);
  const stage = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  return {
    async read() {
      const start = performance.now();
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(source, 0, stage, 0, bytes);
      device.queue.submit([encoder.finish()]);
      const mapping = performance.now();
      await stage.mapAsync(GPUMapMode.READ);
      const mapped = performance.now();
      const output = new Float32Array(stage.getMappedRange().slice(0));
      stage.unmap();
      return { output, readbackMs: performance.now() - start, mapMs: mapped - mapping };
    },
    destroy() { source.destroy(); stage.destroy(); },
  };
}

function activationFor(f16Bytes) {
  const a = new Float32Array(f16Bytes / 2);
  for (let i = 0; i < a.length; i++) a[i] = ((i * 13) % 127 - 63) / 64;
  return a;
}

async function uploadOnReceiver(frame) {
  const start = performance.now();
  const values = unpackF16(frame.data);
  const unpackMs = performance.now() - start;
  const { device } = await ensureGpu();
  const bytes = values.byteLength;
  if (!gpu.sink || gpu.sinkBytes < bytes) {
    gpu.sink?.destroy();
    gpu.sink = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
    gpu.sinkBytes = bytes;
  }
  const upload = performance.now();
  device.queue.writeBuffer(gpu.sink, 0, values);
  await device.queue.onSubmittedWorkDone();
  return { unpackMs, uploadMs: performance.now() - upload };
}

function onControl(endpoint, event) {
  let message;
  try { if (typeof event.data !== "string" || event.data.length > 1024) return; message = JSON.parse(event.data); }
  catch { return; }
  if (!message || typeof message !== "object" || !Number.isSafeInteger(message.id) || message.id < 0) return;
  if (endpoint.role === "echo" && message.t === "ping") {
    endpoint.control.send(JSON.stringify({ t: "pong", id: message.id }));
  } else if (endpoint.role === "host" && (message.t === "pong" || message.t === "ack")) {
    pending.get(`${message.t}:${message.id}`)?.resolve(message);
  }
}

function attach(endpoint, channel) {
  if (channel.label === "pooled-probe-wire") {
    attachChannel(endpoint.link, channel, async (frame) => {
      if (endpoint.role !== "echo") return;
      try {
        const timing = await uploadOnReceiver(frame);
        endpoint.control.send(JSON.stringify({ t: "ack", id: frame.pos, ...timing }));
      } catch (error) { status(`Receiver GPU error: ${error.message}`); }
    });
    channel.onopen = updateConnection;
  } else if (channel.label === "pooled-probe-control") {
    endpoint.control = channel;
    channel.onmessage = (event) => onControl(endpoint, event);
    channel.onopen = updateConnection;
    channel.onclose = updateConnection;
  }
}

function makeEndpoint(role) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const endpoint = { role, pc, link: makeLink({ dup: 0 }), control: null };
  endpoints.push(endpoint);
  pc.onconnectionstatechange = updateConnection;
  if (role === "host") {
    host = endpoint;
    attach(endpoint, pc.createDataChannel("pooled-probe-wire", { ordered: true }));
    attach(endpoint, pc.createDataChannel("pooled-probe-control", { ordered: true }));
  } else {
    pc.ondatachannel = (event) => attach(endpoint, event.channel);
  }
  return endpoint;
}

async function iceComplete(pc) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pc.removeEventListener("icegatheringstatechange", check); reject(new Error("ICE gathering timed out")); }, 15000);
    const check = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); resolve();
    };
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
}

function signalFromPaste(expectedType) {
  const raw = $("signalIn").value;
  if (raw.length > 100000) throw new Error("signal is too large");
  const signal = JSON.parse(raw);
  if (signal?.type !== expectedType || typeof signal.sdp !== "string") throw new Error(`paste a ${expectedType} signal`);
  return signal;
}

async function createOffer() {
  closeEndpoints();
  const endpoint = makeEndpoint("host");
  await endpoint.pc.setLocalDescription(await endpoint.pc.createOffer());
  await iceComplete(endpoint.pc);
  $("signalOut").value = JSON.stringify(endpoint.pc.localDescription);
  status("Offer ready. Copy it to device B.");
}

async function acceptOffer() {
  const offer = signalFromPaste("offer");
  closeEndpoints();
  const endpoint = makeEndpoint("echo");
  await endpoint.pc.setRemoteDescription(offer);
  await endpoint.pc.setLocalDescription(await endpoint.pc.createAnswer());
  await iceComplete(endpoint.pc);
  $("signalOut").value = JSON.stringify(endpoint.pc.localDescription);
  status("Answer ready. Copy it to device A.");
}

async function setAnswer() {
  if (!host) throw new Error("create an offer on this device first");
  await host.pc.setRemoteDescription(signalFromPaste("answer"));
  status("Answer set. Waiting for the data channels to open.");
  updateConnection();
}

async function loopback() {
  closeEndpoints();
  const a = makeEndpoint("host"), b = makeEndpoint("echo");
  await a.pc.setLocalDescription(await a.pc.createOffer());
  await iceComplete(a.pc);
  await b.pc.setRemoteDescription(a.pc.localDescription);
  await b.pc.setLocalDescription(await b.pc.createAnswer());
  await iceComplete(b.pc);
  await a.pc.setRemoteDescription(b.pc.localDescription);
  status("Local loopback connecting.");
}

async function controlPing() {
  const id = ++seq, response = pendingResponse("pong", id), start = performance.now();
  host.control.send(JSON.stringify({ t: "ping", id }));
  await response;
  return performance.now() - start;
}

async function gpuOnly() {
  const f16Bytes = Number($("size").value);
  const { device } = await ensureGpu();
  const probe = makeGpuReadback(device, activationFor(f16Bytes));
  try {
    await probe.read(); // warm the queue and mapping path
    const readback = [], mapping = [];
    for (let i = 0; i < 20; i++) {
      const sample = await probe.read();
      readback.push(sample.readbackMs); mapping.push(sample.mapMs);
    }
    report({ mode: "GPU readback only", f16Bytes, adapter: gpu.adapterInfo,
      gpuReadbackMs: summarize(readback), mapAsyncMs: summarize(mapping) });
  } finally { probe.destroy(); }
}

async function fullHop() {
  if (!host || !wireReady(host.link) || host.control?.readyState !== "open") throw new Error("connect two endpoints first");
  const f16Bytes = Number($("size").value);
  const { device } = await ensureGpu();
  const probe = makeGpuReadback(device, activationFor(f16Bytes));
  const ping = [], full = [], readback = [], pack = [], frameAck = [], unpack = [], upload = [];
  try {
    for (let i = 0; i < 20; i++) ping.push(await controlPing());
    // Warm receiver allocation and f16 lookup table before recording samples.
    const warm = await probe.read(), warmId = ++seq, warmAck = pendingResponse("ack", warmId);
    if (!sendFrame(host.link, { t: "ai-hidden", pos: warmId, data: packF16(warm.output) })) throw new Error("wire channel closed");
    await warmAck;
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const sample = await probe.read();
      const packStarted = performance.now();
      const data = packF16(sample.output);
      const packedAt = performance.now();
      const id = ++seq, ack = pendingResponse("ack", id);
      if (!sendFrame(host.link, { t: "ai-hidden", pos: id, data })) throw new Error("wire channel closed");
      const response = await ack;
      full.push(performance.now() - started);
      readback.push(sample.readbackMs);
      pack.push(packedAt - packStarted);
      frameAck.push(performance.now() - packedAt);
      unpack.push(response.unpackMs);
      upload.push(response.uploadMs);
      await pause(20);
    }
    report({ mode: endpoints.length === 2 ? "same-tab loopback" : "manual WebRTC pairing", f16Bytes,
      adapter: gpu.adapterInfo, samples: 20,
      note: "frame-to-ack includes the forward framed DataChannel hop and return control ACK; ping is a separate small-message RTT",
      controlRttMs: summarize(ping), gpuReadbackMs: summarize(readback), cpuPackMs: summarize(pack),
      frameToAckMs: summarize(frameAck), remoteCpuUnpackMs: summarize(unpack), remoteGpuUploadMs: summarize(upload),
      fullPathAndAckMs: summarize(full) });
  } finally { probe.destroy(); }
}

async function runButton(action) {
  if (busy) return;
  busy = true; updateConnection();
  let errorMessage = null;
  try { await action(); }
  catch (error) { errorMessage = `Probe error: ${error.message}`; }
  finally { busy = false; updateConnection(); if (errorMessage) status(errorMessage); }
}

$("loopback").onclick = () => runButton(loopback);
$("offer").onclick = () => runButton(createOffer);
$("accept").onclick = () => runButton(acceptOffer);
$("answer").onclick = () => runButton(setAnswer);
$("gpu").onclick = () => runButton(gpuOnly);
$("hop").onclick = () => runButton(fullHop);
status("Probe ready. Choose a connection method or measure GPU readback.");
