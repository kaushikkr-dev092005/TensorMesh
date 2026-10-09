# TensorMesh verification — 2026-10-03

## Verified

- Strict TypeScript compilation and portable production frontend build passed.
- Actual Tauri CLI `build --debug --no-bundle` passed, including its npm frontend hook. Output: `src-tauri/target/debug/tensormesh.exe`.
- `cargo check --manifest-path src-tauri/Cargo.toml` passed.
- Native Rust command unit tests passed: 3 tests covering graph barriers/input bounds, speculation cost selection, and placement capacity/hop cost. These are direct Rust tests, not IPC tests.
- pooled-core tests passed: 20.
- Packaged asset verification passed: 76 imported runtime modules and referenced HTML/CSS/manifest assets, zero failures. Two optional development eval imports are intentionally excluded and that mode is NOT VERIFIED.
- Production frontend served on loopback port 1420, rendered its room screen, and created real room FF39 with a 1 GB pledge and model-fit controls. Browser console warning/error inspection returned an empty list for that check. No model was downloaded or executed.
- Compiled executable launched through Windows application automation. One TensorMesh window was returned, and its React interface at `http://tauri.localhost/` rendered. The window disappeared during the next IPC check after automation reported user input. Cause of disappearance is not established; this is not proof of a crash or a successful command call.

## Fixes and relevant rechecks

Copied manifests and font CSS retained server-root asset URLs, while desktop assets live under `/runtime`. The runtime copy script now rewrites those references; rebuilt production assets and the asset verifier passed.

The UI inferred “Rust runtime connected” solely from Tauri presence. It now says “Tauri desktop shell” / “Desktop mode”, avoiding a false connection claim. Strict compilation and the actual Tauri frontend hook passed after this change.

The portable server previously converted every request exception to a 404. Unexpected errors now log and return 500; missing files remain 404. Syntax check passed; revised error-path runtime behavior is NOT VERIFIED.

## NOT VERIFIED / remaining requirements

- Frontend-to-Rust IPC execution of all seven registered commands, including error paths.
- GPU probe execution, WebView2 WebGPU support and full multi-device model inference.
- GGUF registry persistence, concurrent registrations and file dialog behavior on desktop.
- Native event exchange: no application event protocol or managed Tauri state is currently implemented. Persistent native data is a file-backed model registry.
- Effective filesystem/process/network permission denial paths. Capability configuration is narrow by inspection, but actual enforcement has not been tested.
- Native embedded room startup and code-preview CSP behavior. Static inspection raises a concern about local blob previews with inline/data scripts under the packaged CSP; reproduce before changing security policy.
- Installer packaging/install/uninstall, release build, cross-platform builds, clean-machine launch and absence of all critical runtime defects.
- Vite development startup failed in this environment because esbuild subprocess launch returned EPERM. Portable production startup succeeded.

## Environment evidence

Initial Cargo fetch failed with Schannel SEC_E_NO_CREDENTIALS. A temporary loopback registry relay used Node HTTPS with normal certificate verification and Cargo checksum verification; no global registry/TLS/security setting changed. Initial native build failed when Windows Application Control blocked a selectors build script (OS error 4551). Normal cargo test subsequently completed; rerunning the same Tauri build succeeded. No endpoint protection was disabled or bypassed. A Cargo lockfile now records the first resolution of the existing manifests; dependency versions were not intentionally upgraded.

This audit is incomplete. Compilation and a rendered desktop window do not establish working native IPC, permissions, state persistence or GPU inference.

## Continued audit: native execution

The latest bundled desktop binary was built with `cargo build --manifest-path src-tauri/Cargo.toml --locked --offline --features tauri/custom-protocol` after successful strict TypeScript and portable frontend builds. Plain `cargo build` had briefly produced a development binary loading localhost:1420; its graph IPC result is recorded separately. The final probe, speculation, placement and room tests used the bundled binary at tauri.localhost.

- `devices` IPC displayed Intel UHD, NVIDIA RTX 3050, and software/backend variants in the actual desktop UI.
- `graph_plan` IPC returned 7 dispatches, 40,960 bytes, one arena, 256-byte alignment in the development desktop binary.
- `gpu_probe` initially failed with a wgpu bind-group validation panic. Root cause: auto-layout preserves an empty group 0 because the unchanged browser shader resources start at group 1. Native dispatch bound only group 1. Added the empty group 0 binding. The rebuilt bundled app reran 100 dispatches on Intel UHD / Vulkan and returned parity passed, max absolute error zero, 0.4554 ms average wall time. This is fixture parity, not model throughput or NVIDIA verification.
- `speculation_plan` IPC returned K=4, 3.362 expected tokens/round, 152.80 estimated tokens/s for illustrative supplied timings.
- `placement_plan` IPC returned 15.00 ms estimated token time, host layers [0,2), peer layers [2,4) for illustrative supplied timings.
- Packaged room creation under the desktop CSP succeeded: room TFXN, 1 GB pledge, fit controls, QR invitation. Full model execution and Code preview remain NOT VERIFIED.
- Four native command tests now pass. Model registry helpers were extracted without changing IPC behavior to test real filesystem persistence, repeat registration, corrupt JSON preservation, truncated headers, wrong magic and unsupported versions. This direct helper test does not prove file dialog or registration IPC.
- Rust workspace and desktop formatting checks passed using workspace `--all`.

A later Tauri CLI rebuild attempt failed its npm hook (`npm` not found) despite the temporary shim being present. This environment failure is retained; the successful previous CLI build is not a claim that the latest CLI hook passed. Backend rebuild with bundled-asset feature succeeded. Attempting the separate pooled-native CLI offline also failed because its workspace lock required an uncached libc version; GPU execution was instead verified through real desktop IPC.

Remaining: register_model/models IPC with persistence across app restart, native application event protocol (currently absent), permission enforcement/denial tests, code-preview CSP reproduction, installer/release verification, repository-wide runtime checks and full inference. Goal remains incomplete.
