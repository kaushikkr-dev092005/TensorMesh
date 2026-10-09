# TensorMesh desktop frontend

The React / TypeScript / Tauri workspace for the standalone TensorMesh runtime. See [local setup and verification](../docs/standalone-local.md) and the [project README](../README.md).

## Browser

Use `npm run start:local` from the repository root after building the frontend. It runs both the site on port 1420 and TensorMesh signaling on port 9000.

## Desktop

Requires Rust 1.89+, Node 22.18+, npm, Visual Studio C++ build tools and WebView2 on Windows.

Start `npm run signal:tensormesh` from the repository root. In another terminal, from this directory:

```powershell
npm ci
npm run tauri dev
```

Build an installer using `npm run tauri build`. Native source dependencies are local crates in ../rust; their retained crate names are pooled-core and pooled-native. Room discovery uses only the configured TensorMesh signaling service.

Browser WebGPU provides model execution; native commands provide adapter discovery, model header registration, Q4 parity probes, graph/memory plans and placement tools. Full native transformer execution remains in development. No new native executable or installer was verified in this standalone UI update. Historical reports under docs describe earlier checkouts.

The supplied Vortex and Lace canvas effects run only outside room workspaces, respect reduced motion and hidden tabs, and have a pause control.
