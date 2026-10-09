# TensorMesh audit â€” 2026-10-04

The audit remains active. This report separates observed execution from source inspection and unverified behavior.

## New runtime evidence

A temporary, bundled audit page ran in a real Tauri main window at tauri.localhost, using the installed official Tauri SDK and the existing Rust command handler. No mocked commands or permission expansion were used. A temporary TAURI_CONFIG window URL selected that page; it has now been removed from dist and the ordinary bundled app rebuilt.

Both native audit runs ended with zero failures:

- All seven registered commands were invoked: devices, gpu_probe, graph_plan, speculation_plan, placement_plan, models, register_model.
- Header-only GGUF v3 fixture: 24 bytes, seven declared tensors. Native registration inspected those fields and repeat registration retained one entry. This does not prove weight validity or inference.
- A new native process read the same registered entry before registration, proving file-backed state persistence across restart.
- Invalid graph, probe, speculation, and placement inputs were rejected through actual IPC.
- Official listen/emit/unlisten passed an event payload through Tauri's native event service. This verifies framework event transport, not an application-specific Rust-emitted event protocol; none currently exists.
- Unapproved `plugin:dialog|save` was rejected with `dialog.save not allowed`, identifying dialog:allow-save/dialog:default as required capabilities. The app retains only dialog:allow-open.
- Cross-origin HTTP fetch to loopback was blocked, with a connect-src CSP violation observed. Arbitrary HTTPS remains intentionally permitted for model/signaling traffic.
- Opening the native file selection dialog was observed. Automated selection/submission could not be verified because Windows automation rejected returned control indices and was interrupted by user input.

Evidence screenshots: [native IPC](../../../../work/native-ipc-audit.png), [restart persistence](../../../../work/native-ipc-persistence.png).

## Packaging fix and recheck

Portable build and runtime synchronization previously copied into existing generated directories. Removed files and temporary audit assets could survive later builds. Both scripts now verify their generated target paths and clear those outputs before copying. After the change: strict TypeScript compilation passed, production build passed, asset verification passed over 76 modules, temporary audit HTML/SDK paths were confirmed absent, and the ordinary bundled native binary rebuilt successfully.

The temporary page generator is `scripts/audit-ipc.mjs`. It requires an explicit header fixture argument. Do not ship its generated page; a normal production build removes it.

## Repository checks

- 356 JavaScript/mjs source files across engine, room, harness, site, benchmarks, tests and CLI passed node syntax checks.
- The production asset verifier checks HTML script/link paths, selected CSS URLs, manifest icons and relative module imports. It is not a proof that every runtime fetch or optional development mode works.
- Two development-only eval imports are intentionally absent from the desktop bundle; that mode remains NOT VERIFIED.
- Deno suite first failed to fetch its pinned assertion dependency without network access. With a writable workspace cache and network access, dependencies fetched, but the default type gate failed due to missing npm:@types/node. A separately recorded JavaScript runtime test attempt (`--no-check`) crashed in Deno 2.9.7 with Windows pipe access/invalid-handle errors before test results. Neither gate is marked passing. Full output is in work/deno-unit-audit.log.
- Revised portable server tested on temporary loopback port 14322: normal page 200, absent path 404, unexpected URI error 500. The 500 error was logged with its stack trace rather than hidden.

## Requirement coverage

| Requirement | Current evidence/status |
| --- | --- |
| 1 Tauri build | Prior actual Tauri CLI debug build passed. Latest ordinary Cargo build with tauri/custom-protocol passed. A later CLI hook failed to find npm; installer/release NOT VERIFIED. |
| 2 Frontend startup | Production browser and native React startup observed. Vite dev subprocess remains blocked by environment. |
| 3 Rust startup | Actual native process served successful command calls. |
| 4 IPC | Seven original command success paths and four invalid-input paths exercised in actual Tauri; the added preview_host command also returned its loopback origin in the desktop audit. |
| 5 Command registration | All eight named handlers callable; source list and frontend names match. |
| 6 Rust state | File-backed model registry persisted across process restart and deduplicated repeated registration. The preview relay now uses Tauri-managed PreviewHost state. Concurrent in-process registration passed after a file-lock correction; cross-process locking/crash recovery NOT VERIFIED. |
| 7 Events | Native Tauri event-service roundtrip and unlisten passed. No domain event protocol implemented. |
| 8 Permissions | Open dialog observed; save denial and CSP HTTP denial verified. Process APIs are absent by source configuration; exhaustive filesystem/process/network enforcement NOT VERIFIED. |
| 9 Desktop launch | Real TensorMesh and temporary audit windows observed. |
| 10 Critical defects | Fixed and reran native GPU binding and packaging defects. Full model execution, code preview, all repository runtime paths and absence of all crashes NOT VERIFIED. |
| 11 Evidence-based claims | Compile success, runtime success, source inspection and missing evidence distinguished in this report. |
| 12 Visible errors | Build, type-check, Deno panic, automation and request errors retained in reports/logs. |
| 13,17 Architecture | Existing Rust commands, file-backed registry and bundled JS inference engine retained. |
| 14 Dependencies | No upgrade performed; existing lockfiles retained. |
| 15 Security | Capabilities, main script-src and connect-src retained. Runtime adds only the exact session loopback relay origin to frame-src. Relay content has a separate CSP for sandboxed code execution. |
| 16 Functionality | Audit calls use actual SDK/native handlers; fixtures test metadata only. |
| 18 Untestable behavior | Explicit NOT VERIFIED entries above and below. |
| 19 Compile/runtime | Separate observations and commands above. |
| 20 Root causes | GPU empty group-0 binding omission; server-root asset URLs; stale generated output copying. |
| 21 Rechecks | GPU fixture passed through desktop IPC after correction; production assets/build passed after packaging corrections; server responses and logging checked after error handling correction. |

## Remaining work

Exhaustive preview IPC isolation; installer/release verification; repository test runner/type dependency resolution; broader runtime coverage. Full inference and exhaustive crash-free claims remain unproved. The goal is not complete.

Final ordinary desktop relaunch succeeded after clean packaging. The normal Models view displayed the persisted header-only fixture (GGUF v3, seven tensors). Screenshot: work/native-models-persistence.png. The two pooled-native unit tests also passed.

## Desktop preview relay continuation

Reproduced generated JavaScript failing in the packaged blob preview while the same valid fixture executed in a separate native HTTP baseline window. Blob content inherited the main CSP, which disallows generated inline/data scripts.

Implemented a fixed-path, read-only loopback relay using the existing preview-relay.html and mountPreview architecture. It binds 127.0.0.1 on an ephemeral port, validates Host, caps request headers, uses socket timeouts, rejects unknown paths, and stops its listener on state drop. No weight/file routing is provided. The main runtime adds only this exact origin to frame-src. The existing allow-scripts-only sandbox is retained. Room launch resolves preview_host before constructing its URL, including the initial-load race.

Actual native audit observations:

- preview_host returned its real bound origin.
- Generated JavaScript executed through mountPreview and the HTTP relay.
- The generated document could not read its parent document.
- A main-window fetch to the relay was blocked, with an observed connect-src violation.
- The Tauri bridge object exists in the generated frame. Its attempted devices invocation failed on the fetch path and timed out on the fallback path, including with audit callbacks registered in the main frame. This is NOT proof of native permission denial. Exhaustive IPC isolation remains NOT VERIFIED. Tauri 2.12.1 source rejects remote custom commands without explicit remote capability; current capabilities have no remote grant.

The audit fixture uses real preview generation, relay networking, WebView2, CSP and Tauri commands; no inference is simulated. Reproduction script: scripts/audit-preview.mjs. It intentionally reports IPC isolation as NOT VERIFIED rather than treating a timeout as denial. Evidence: work/native-preview-relay.jpg.

A repeated Rust test exposed inherited nonblocking mode on accepted Windows sockets (10035, followed by client connection abort 10053). Explicitly switched accepted streams to blocking mode with bounded timeouts. All five native tests passed after the correction; the relay regression also waits before sending headers to exercise this timing. Two frontend invitation tests passed. TypeScript, portable build and the 76-module asset check passed.

Shell-native launches repeatedly failed with WebView2 HRESULT 0x800700AA (requested resource in use), including a separate audit profile. Desktop API launch succeeded for the normal app and subsequent audit windows. The root cause of the shell-launch difference is NOT VERIFIED; no system security changes were made. Normal production build was restored after the temporary audit, generated audit.html was absent, and desktop relaunch succeeded.

Post-correction native preview rerun again passed JavaScript execution, parent-document isolation and main connect-src denial. The normal application created room R9EK and rendered the model/memory/invitation workspace. Its observed iframe URL contained the URL-encoded desktoppreview=http://127.0.0.1:50351, confirming the Rust relay origin reaches the bundled room. No model was started. Evidence: work/tensormesh-room-relay.jpg.

## Repository tests and registry concurrency

Installed the CLI dependencies from its existing npm-shrinkwrap.json with npm ci --ignore-scripts --no-audit --no-fund. No package versions or lockfiles changed. All 64 existing CLI tests passed with node --test --test-isolation=none cli/test/*_test.mjs; CLI --help also executed. The existing suites use stand-in room fixtures, so this proves HTTP/request/stream/store/bridge handling, not distributed inference or real WebRTC connectivity. Log: work/cli-unit-audit.log. Initial default-isolation invocation failed with spawn EPERM; the initial same-process run lacked the OpenAI/Anthropic SDK dependencies.

A cached Deno hop-probe test still panicked in the Windows named-pipe test channel (access denied 5, invalid handle 6) before producing test results. Deno tests remain NOT VERIFIED.

A new concurrent registry regression started eight store_model operations together. Before correction they all returned success but only one entry survived. Root cause: unprotected read/modify/write, with shared temporary filename and no serialized transaction. store_model now holds a standard-library OS file lock on the stable companion models.lock through read/modify/atomic replacement. Errors remain visible. This requires Rust 1.89 or newer, now declared in the app manifest; the installed compiler was not upgraded. All six native tests passed, including the eight-entry concurrency assertion and the existing metadata/persistence/corruption checks. An initial cleanup failure (directory not empty because the new lock file remains) was fixed in the test cleanup. Cross-process lock behavior and crash recovery remain NOT VERIFIED.

## Installer build gate

The actual Tauri CLI frontend hook and debug native build completed after making the existing workspace npm launcher available in PATH. An initial rebuild failed because the running desktop executable was locked; after closing the test window, the executable build passed.

NSIS packaging downloaded and verified the declared NSIS 3.11 archive, then failed during extraction with Access is denied (os error 5). A process-only bundle.useLocalToolsDir=true configuration and a narrow filesystem grant for the default AppData/Local/tauri tool cache both produced the same failure. Saved application config and capabilities were not expanded. Extraction failure root cause remains NOT VERIFIED. Installer generation, installation and release-mode validation are NOT VERIFIED.

After the registry lock change, the actual SDK/native main-window audit ended with zero failures: all seven original commands, repeated registration/deduplication, persisted entry, four invalid-input paths, GPU parity (max absolute error zero), event-service roundtrip, dialog-save denial and main HTTP CSP denial. Evidence: work/native-registry-lock-audit.jpg. The fixture remains header-only; no full model inference is claimed.

Final ordinary Tauri CLI build --debug --no-bundle passed after the registry correction. The normal frontend hook ran, asset verification passed, temporary audit.html was absent, and the desktop API launched a rendered TensorMesh Rooms screen. Installer packaging remains separate and NOT VERIFIED.

## Standalone JavaScript WebGPU execution and Windows test paths

The existing tests/test_selftest.js passed under Deno run --unstable-webgpu: f32, Q8 and Q4 self-tests plus RMSNorm, Q8 matvec, head norm, RoPE, attention/softmax, SiLU multiply, residual add and full-layer micro-tests. The existing generator_smoke.js passed three workgroup/shape configurations. These execute without Deno's failing unit-test channel. Retrying the cached hop-probe unit test with a PTY still panicked with named-pipe access denied; the unit runner remains NOT VERIFIED.

Found a Windows E2E path defect: path.resolve(new URL(...).pathname) yielded C:\C:\Users... and module-entry equality checks could silently skip execution. Replaced file URL pathname conversions with Node fileURLToPath in the shared engine helper, both synthetic generators and 24 other E2E scripts using the same pattern. All E2E scripts passed syntax checks. A direct request to the shared local server returned the exact real engine/dense.js source after correction. Both synthetic generators executed on Windows and wrote valid fixture metadata/files. Broader browser E2E runtime remains NOT VERIFIED: preview_browser.mjs reached browser launch after installing the existing locked Playwright 1.49.1 dependencies, then failed with spawn EPERM for installed Edge. No project dependency versions or lockfiles were upgraded.

Exported the existing engine_synth test body with an optional moduleBase for non-browser imports; browser behavior retains its original default. tests/engine_synth_deno.js invokes that exact test body through actual Deno WebGPU and a generated GGUF fixture. It does not substitute mock engines, emulate browsers, or claim to exercise Rust full-model inference.

The initial four-layer/128-width diagnostic passed 31 checks. The default fixture (eight trunk layers, width 256, next-token head, 40-token runs) then passed all 45 checks: greedy decode, deterministic reset, speculative K=1/3/7 equivalence, two and three engine layer partitions, fp16 transfer rounding, multi-turn continuation vs fresh prefill, both batchCols 4/16, and no GPU validation errors. Log: work/engine-synth-deno-audit.log. Partitions execute sequentially on one GPU; actual network transport/heterogeneous placement is NOT VERIFIED by this test. Seeded fixtures prove control-flow/kernel equivalence, not pretrained model quality or llama.cpp parity.

The existing diagnostic warned that draft K-cache rows 14 and 26 differ after continuation vs fresh prefill. Output-equivalence checks and the displayed acceptance counts agreed. The warning is retained; its root cause and wider impact remain NOT VERIFIED.

## October 5 continuation: installer and incomplete MoE run

The full MoE synthetic run ended with process exit code -1 before a completion summary. The retained log (`work/engine-moe-deno-audit.log`) contains passing solo and two-stage NC=4 checks, but no completed three-stage/NC=16 results. Full MoE execution is NOT VERIFIED. Windows Application events contained a WER RADAR_PRE_LEAK_64 entry for deno.exe 2.9.7.0 near the run; no crash stack was observed. This is not proof of the exit's cause. The test creates multiple engines without an explicit per-engine disposal path, but resource retention has not been established as the cause. The independent GPU self-test passed after this exit.

Prepared the official NSIS 3.11 tools in `src-tauri/target/.tauri/NSIS` using workspace-only Python extraction. Both downloaded artifacts were checked against the hashes declared by the installed CLI's matching Tauri source: archive SHA1 EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D; nsis_tauri_utils 0.5.3 DLL SHA1 75197FEE3C6A814FE035788D1C34EAD39349B860. All extraction destinations were checked to stay inside the cache. The environment-only local-tools setting still attempted the default download/extraction and failed with access denied.

Passing the setting explicitly to the CLI selected the prepared tools and completed successfully:

```powershell
node node_modules/@tauri-apps/cli/tauri.js bundle --debug --no-binary-patching --config '{"bundle":{"useLocalToolsDir":true}}'
```

Produced `src-tauri/target/debug/bundle/nsis/TensorMesh_0.1.0_x64-setup.exe`, reported 6.47 MiB. SHA256: 2205241947E1C2240C08004719C50D7026EA4E3D61D166D0C9BFD50069CF2C60. This verifies debug installer generation only; installation, uninstall and release mode remain NOT VERIFIED. The original extraction access-denied root cause remains unknown. No app permissions, dependency versions or system protections changed.
