# TensorMesh standalone local flow

The standalone repository is `outputs/tensormesh`; the earlier checkout is preserved separately. No upstream Git remote is configured. GitHub UI controls, star-count fetching, upstream ownership configuration and the upstream staging deployment command have been removed.

## Invitation execution path

Previously, the upstream `roomLink()` generated `${location.origin}/r/${roomCode}` when served from `/room` or `/r/`. Other pages appended `code` to their page URL. The deployed origin was the upstream website. Discovery defaulted to the public PeerJS cloud, with the `pooled-room-` namespace.

TensorMesh owns the path:

1. React Create Room opens its bundled `/runtime/p2p.html` worker UI.
2. `room.js` creates a code and registers `tensormesh-room-<code>` on the configured TensorMesh signaling server.
3. `roomLink()` calls `generateRoomInvite()` in `room/invite.js`. Both the QR renderer and copy controls consume that same function.
4. The link is `http://localhost:1420/room/<code>?signal=<encoded endpoint>&expires=<timestamp>`.
5. The local server serves the React application at `/room/<code>`.
6. `parseRoomInvite()` validates the code, route, endpoint and expiration before opening the room workspace.
7. The workspace discovers the host through `ws://127.0.0.1:9000/tensormesh`, key `tensormesh`, and establishes browser WebRTC channels. No public discovery fallback exists.
8. Entering a code uses the same configured server and room namespace.

Expiry is a client validation field, not signed access control. An unavailable host is reported by discovery. Rooms are for trusted groups.

## Configuration

No environment changes are needed for the local defaults:

- `TENSORMESH_PUBLIC_ORIGIN=http://localhost:1420`
- `TENSORMESH_SIGNAL_URL=ws://127.0.0.1:9000/tensormesh`

These values are written into bundled runtime configuration by `tensormesh/scripts/sync-runtime.mjs`. Rebuild after changing them. `npm run start:local` starts both default loopback services. A phone scanning a localhost QR cannot reach this computer: loopback links are for clients on this computer. Other devices require a reachable HTTPS TensorMesh origin and WSS signaling server.

## October 7 verification

- TypeScript and portable production build passed in the standalone directory.
- 74 tests passed: 64 CLI regressions, six invite/policy tests and four standalone/UI/effect lifecycle tests.
- Two frontend parser tests and seven independent invitation assertions passed.
- Real signaling test passed registration, offer/answer forwarding and unavailable-room expiry.
- Browser UI created room FYPN, copied an invitation, joined a second tab through `/room/FYPN`, and joined a third by code. The room roster showed three connected devices and 3 GB.
- An expired URL displayed `Room invite expired or invalid` without opening the room workspace.
- Both canvas effects rendered; the pause control changed to Resume background. Room workspaces contained zero background-effect canvases.
- 628 source/text files were scanned with no legacy hosted-domain literal. Packaged module checks passed for 77 files; two development-only eval imports remain intentionally absent.
- This verification did not load a model, measure distributed inference throughput, rebuild the native executable or run an installer. Earlier native audit reports are historical evidence from the prior checkout.

## Commands

From the repository root:

```powershell
npm ci --ignore-scripts
npm --prefix tensormesh ci --ignore-scripts
npm --prefix tensormesh run build
npm run start:local
```

In a second terminal:

```powershell
npm run test:invite
npm run test:standalone
npm run test:invite:signal
npm --prefix tensormesh test
```

CLI regressions additionally require `npm --prefix cli ci --ignore-scripts`, then `node --test --test-isolation=none cli/test/*_test.mjs`. Run `node scripts/verify-assets.mjs` from the frontend directory. Stop local services before running `npm run e2e:invite`, which starts its own servers; that automated browser launcher is restricted on this machine, so the browser checks above used the in-app browser.

## Main changed files

- Project manifests and lockfile metadata, root README and gitignore.
- `index.html`, `p2p.html`, `room.js`, `harness/export.js`, manifest/logo labels and preview-host policy.
- `tensormesh/src/App.tsx`, `BackgroundEffects.tsx`, `styles.css`, both supplied effect modules and their declarations.
- `scripts/start-local.mjs`, `tests/standalone_test.mjs`, invite test fixtures and CLI executable branding.
- Removed `site/js/stars.js`, upstream staging script and upstream GitHub ownership/support configuration.
- Historical documents use a reserved invalid upstream hostname rather than the hosted service. Copyright notices remain in LICENSE and AUTHORS.

