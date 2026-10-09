# Rust runtime path

The Rust workspace now contains `pooled-core` and `pooled-native`. Run the dependency-free tests with `cargo test --manifest-path rust/Cargo.toml -p pooled-core --offline` from the repository root.

It implements the first pieces needed by a native executor:

- An ordered graph with explicit hybrid-model nodes, including MoE, DeltaNet, conv1d, and gating. A transient tensor must be produced before use.
- A conservative graph compiler that lowers supported norm/QKV/RoPE and projection/residual fusions, then runs activation planning on the lowered graph. Branches, retained tensors, and persistent-state writes prevent intermediate elimination. Attention split and reduce stay separate.
- An indirect dispatch table with checked per-dimension workgroup limits, 12-byte records, and explicit byte offsets.
- Static activation allocation using last use, 256-byte offsets, `maxBufferSize`, and `maxStorageBufferBindingSize`. Weights, KV, and recurrent state stay outside that arena. The caller retains outputs that survive the graph. The planner reports allocation offsets and buffer sizes; it does not create GPU buffers.
- Dynamic programming for contiguous layers over an ordered chain. It uses per-layer measured compute cost, weight capacity, and measured end-to-end hop cost. Device 0 holds at least one layer. Single-stream pipeline placement is for capacity and latency minimization; throughput requires several sessions in flight.
- A roofline lower bound and a speculation-depth choice from measured verification times and round-trip cost.
- A scalar Q4_0 reference matvec, including f16 scale decoding and the browser kernel's split-nibble layout.

Run `cargo run --manifest-path rust/Cargo.toml -p pooled-core --example compile_graph --offline` to inspect a synthetic attention graph. With illustrative backend capabilities, seven operations lower to four dispatches. The example prints original node ranges, external tensor dependencies, and activation buffer offsets. Fused kernel capabilities default to disabled; the graph compiler does not implement those GPU kernels. See [the compiler contract](../docs/rust-graph.md).

`pooled-native` is an initial native `wgpu` parity probe. It reads `engine/wgsl/base.js` at compile time, extracts the unchanged WGSL, executes `matvec_q4` on a non-workgroup-multiple row count, checks every output against the CPU oracle, and prints adapter, backend, wall time, and maximum absolute error. Its source now obtains output buffer sizes and offsets from the compiled memory plan and uses the plan's indirect dispatch records. Run `cargo run --manifest-path rust/Cargo.toml -p pooled-native --release -- 100` to dispatch it 100 times. This is a small-kernel correctness and host-path smoke test, not model logit or throughput parity.

The native runner has not executed in this development environment: local application control blocks the `libc` dependency build script (OS error 4551). Its code uses cached `wgpu` 0.20.1 to avoid the environment's Cargo TLS download failure. On a machine that permits Rust dependency build scripts, compile and run the command above before treating native parity as established.

The GitHub CI definition now includes a pinned Rust toolchain, workspace formatting, compilation of the native host, GPU-free tests, and the graph example on Linux. This workflow has been added locally and has not run on GitHub. Windows application control also began blocking rebuilt core test executables during the compiler work; the first 16-test compiler run passed, while later additions compiled but could not execute here.

The next gate is native execution of each existing WGSL kernel, followed by layer and end-to-end logit and speed parity against the JavaScript engine. After that, build the wasm target and measure per-dispatch wasm-to-JavaScript overhead before switching browser paths. Kernel generation should initially use Rust WGSL templates for Q4_K_M and a small set of validated fusions; an IR is deferred until templates become unmanageable.

The measurement harness still needs per-kernel CPU oracles, llama.cpp logit comparisons, GPU readback and WebRTC hop distributions, and Vulkan and CUDA prefill comparisons. Keep public rooms out of scope until worker trust and prompt privacy are addressed. Native worker transport can use QUIC; browser peer links remain WebRTC DataChannels.
