# GPU and WebRTC hop probe

Serve this repository on `localhost` (for example, `python -m http.server 8080`) and open `/benchmarks/hop_probe.html`. The page needs WebGPU and WebRTC. It uses Pooled's `packF16`, `unpackF16`, `sendFrame`, and frame reassembly path, with synthetic activations and no model download.

Use **Local loopback** for a browser smoke test. For two devices, serve the page on each device's localhost or over HTTPS, then follow the offer/answer copy steps on the page. The manual connection has no STUN or TURN server; it is intended for direct LAN candidates and may fail on networks where host candidates cannot connect. Keep both tabs open until the run finishes.

The probe reports 20 samples after warm-up for 10 KB decode frames and 50 KB speculative-verify frames. `gpuReadbackMs` covers a GPU buffer copy, submission, `mapAsync`, and copying mapped bytes into a typed array. `cpuPackMs` covers f32-to-f16 conversion. `frameToAckMs` covers the production sliced frame's forward trip, receiver unpack and GPU upload, and a small return ACK. `controlRttMs` is a separate small-message baseline. `fullPathAndAckMs` starts before readback and stops at the ACK. The page also reports p50 and p90; do not halve `frameToAckMs` and call it a measured one-way latency.

## Initial smoke measurement

Codex in-app browser on one Windows host, September 30, 2026. Both loopback and manual pairing were within that host. These numbers verify the probe and illustrate local overhead; they do not establish cross-device or LAN performance.

| Mode | f16 frame | Readback p50 | Frame-to-ACK p50 | Full path plus ACK p50 | Full path plus ACK p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Same-tab loopback | 10 KB | 3.45 ms | 2.15 ms | 5.95 ms | 7.73 ms |
| Same-tab loopback | 50 KB | 4.00 ms | 6.00 ms | 10.45 ms | 12.67 ms |
| Manual pairing, two tabs on same host | 50 KB | 3.50 ms | 5.40 ms | 9.30 ms | 12.21 ms |

The next placement gate needs this probe run between actual heterogeneous devices, with the browser and adapter recorded for each endpoint, p50/p90 at both frame sizes, and several runs under load. A same-host loopback cannot validate the network assumptions in the distributed scheduler.
