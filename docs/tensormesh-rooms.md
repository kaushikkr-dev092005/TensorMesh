# TensorMesh-owned room invitations

## Old execution path

`TensorMesh Create → bundled Pooled room.js → pooled-room-<code> on public PeerJS cloud (or legacy POOLED_SIGNAL_SERVERS) → roomLink() overwritten by tensormesh/scripts/sync-runtime.mjs → https://pooled.invalid/r/<code> → Pooled /r rewrite → Pooled room client and its discovery namespace`.

Invite, QR, Copy link and native Share all consumed that overwritten roomLink(). The desktop parser accepted Pooled and arbitrary external URLs containing a code. The root deployment also had hardcoded redirects to pooled.invalid.

## New execution path

`TensorMesh Create → createRoom()/validated ID → tensormesh-room-<code> registered with your TensorMesh signaling server → generateRoomInvite() → https://YOUR-HOST/room/<code>?signal=YOUR-ENDPOINT&expires=... → TensorMesh browser route → parseRoomInvite() → TensorMesh runtime iframe → joinRoom()/start(false) → PeerJS connects to tensormesh-room-<code> using your /tensormesh endpoint and key tensormesh → existing WebRTC hello/roster and inference transport`.

The existing 4–6 character alphabet, host/guest distinction, random guest peer IDs, wire protocol 4, WebRTC frame codec, inference kernels, layer placement and recovery behavior remain. The discovery namespace and room-related storage keys deliberately differ from Pooled. Existing Pooled rooms/invites are rejected; create a new TensorMesh room after updating.

Only room ID, discovery endpoint and expiry are shared. TURN credentials, device preferences, model choices, redirect destinations and arbitrary query fields are excluded. Invite URLs expire after 24 hours; plain codes join only a currently available host. A missing/closed host produces the existing unavailable-room path. Expiry is a client usability check, not authentication or a signed authorization token. Rooms remain private-group/trusted-peer sessions.

## Configuration and local flow

Install the existing locked dependencies (`npm ci` at the root and in `tensormesh`). No new packages are required.

From the repository root, in one terminal:

```powershell
node scripts/tensormesh-signal.mjs
```

This starts your own service on `127.0.0.1:9000`, path `/tensormesh`, PeerJS application key `tensormesh`. It brokers discovery/SDP; model activations still travel over WebRTC. Public PeerJS discovery is disabled and never used as a fallback.

In another terminal:

```powershell
cd tensormesh
$env:TENSORMESH_SIGNAL_URL='ws://127.0.0.1:9000/tensormesh'
$env:TENSORMESH_PUBLIC_ORIGIN='http://localhost:1420'
npm run build
node scripts/serve-portable.mjs
```

Open `http://localhost:1420`, create a room, choose Invite and Copy link, then open that URL in a second tab. The `/room/<id>` route serves the TensorMesh app and joins without navigating through another service. Raw IDs and `tensormesh://room/<id>?signal=...&expires=...` can also be pasted into Join. OS registration for the custom scheme is **not supported** by the current app; generated defaults use working browser URLs. No external deep-link handler was added.

For devices on different machines, replace both loopback URLs with your reachable HTTPS browser origin and WSS signaling endpoint, e.g. `https://mesh.your-domain.example` and `wss://signal.your-domain.example/tensormesh`, and rebuild. You must host the browser client and the service yourself; these domains are examples, not provisioned services. Preserve `/room/<id>` SPA routing and reverse-proxy `/tensormesh` HTTP/WebSocket requests to this service. The root Vercel configuration provides `/room/:code` → `/p2p.html` without redirects. The TensorMesh portable server provides `/room/:code` → `/index.html`.

Service options: `TENSORMESH_SIGNAL_PORT` (default 9000), `TENSORMESH_SIGNAL_BIND` (default 127.0.0.1). An external TLS proxy can expose the loopback service. Client build options: `TENSORMESH_SIGNAL_URL`, `TENSORMESH_PUBLIC_ORIGIN`. Raw root browser deployments may set `window.TENSORMESH_SIGNAL_SERVERS` before room.js; otherwise they use the same origin's `/tensormesh` endpoint. No legacy POOLED_SIGNAL_SERVERS configuration is read.

The native host adds only the configured signaling HTTP/WebSocket origins to its CSP. Capabilities and plugin permissions remain unchanged. Run a normal `npm run tauri build` after configuring and rebuilding the frontend.

## Verification commands

From the repository root:

```powershell
node --test --test-isolation=none tests/tensormesh_invite_test.mjs
node tests/invitation_node.mjs
node tests/tensormesh_signal_flow.mjs
node --test --test-isolation=none cli/test/*_test.mjs
```

From `tensormesh`:

```powershell
node --test --test-isolation=none src/lib/invitation.test.ts
node node_modules/typescript/bin/tsc -b
npm run build
node scripts/verify-assets.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

For automated full UI/WebRTC coverage, stop other local servers on ports 1420/9000, build with the defaults above, then from the root:

```powershell
# Set CHROMIUM to an installed Chromium/Edge binary if Playwright's browser is absent.
node tests/e2e/tensormesh_invite.mjs
```

### October 6 evidence

- Five routing/signaling-policy tests, seven site parser assertions, two desktop parser tests, 64 existing CLI tests and six native tests passed.
- Real self-hosted WebSocket test passed registration, generated-invite join target, offer/answer forwarding and unavailable-room expiry. Its SDP is a signaling fixture, not an inference run.
- Actual in-app browser UI created room 6C4A, opened Invite, displayed the own URL, showed a Copy link success toast, joined another tab by that URL, rejected an expired invite and a Pooled URL, and joined a third device using Join. The roster showed three devices/3 GB and guest reload rejoined. The browser clipboard tool returned an empty value, so exact clipboard contents were not independently verified through that tool.
- TypeScript, portable build, packaged asset checks and native custom-protocol debug build passed. The Tauri CLI frontend hook attempt failed because npm was not found in its child environment; native Cargo build succeeded after the frontend was built independently.
- Standalone Playwright UI test could not launch Edge (`spawn EPERM`). Deno runner panicked in its Windows test pipe before results. These executions remain NOT VERIFIED; no system protections or dependencies were upgraded.
- An updated debug NSIS installer was generated successfully at `tensormesh/src-tauri/target/debug/bundle/nsis/TensorMesh_0.1.0_x64-setup.exe`; installation and native UI after this fix remain NOT VERIFIED. No model was loaded and distributed inference throughput was not retested. The inference implementation was retained.

## Files changed for this fix

- `room/invite.js`, `room/invite.d.ts`: shared TensorMesh invite and room lifecycle helpers.
- `room.js`, `room/signal.js`, `room/plan.js`, `room/resume.js`, `room/errors.js`: actual host/join namespace, share actions, discovery policy, routes and errors.
- `scripts/tensormesh-signal.mjs`: your signaling service.
- `site/js/invitation.js`, `site/js/connect.js`, `p2p.html`, `vercel.json`: browser parsing/navigation, startup and deployment redirects.
- `tensormesh/src/lib/invitation.ts`, `tensormesh/src/App.tsx`: desktop/browser Join and route consumption.
- `tensormesh/scripts/sync-runtime.mjs`, `desktop-diagnostics.js`, `serve-portable.mjs`: packaged configuration, startup and own browser routes.
- `tensormesh/src-tauri/src/main.rs`: exact configured discovery origins in native CSP.
- `cli/lib/invite.js`, `cli/lib/room.js`, `cli/bin/tensormesh.js`: standalone CLI follows the same TensorMesh discovery flow; its legacy executable name is retained. Parser parity is tested.
- `tests/tensormesh_invite_test.mjs`, `tests/tensormesh_signal_flow.mjs`, `tests/e2e/tensormesh_invite.mjs`, `tests/invitation_node.mjs`, `tensormesh/src/lib/invitation.test.ts`, `tests/unit/signal_test.js`, `tests/unit/room_test.js`, `tests/unit/room_relink_test.js`, `tests/e2e/signal_fallback.mjs`: new and migrated routing tests.
- `package.json`, `.github/workflows/ci.yml`, `tensormesh/README.md`, this document: commands, regression gate and migration instructions.

Repository-wide reference search is retained at `work/room-routing-reference-files.txt` outside the repository. Historical reports, attribution, Rust crate names, CLI naming, unrelated model/cache code and old benchmark documents were not renamed. They do not select a Pooled invite or discovery service.
