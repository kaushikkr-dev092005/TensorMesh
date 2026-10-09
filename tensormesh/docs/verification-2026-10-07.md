# TensorMesh audit — October 7

The resumed audit first rechecked shell execution. It still fails before creating a process with the Windows restricted-token sandbox error about split writable roots. Native launch, full GPU reruns, installation and shell test execution remain NOT VERIFIED in this continuation.

## Corrected invite round-trip defect

The current generator accepted HTTP origins under *.localhost, but parseRoomInvite allowed only localhost, 127.0.0.1 and [::1]. A generated http://mesh.localhost:1420/room/ABCD URL was reproduced and rejected by the original parser with Remote browser invites require HTTPS. The parser now uses the same loopback hostname allowance as the generator. The standalone CLI parser copy was updated and byte-for-byte parity verified.

Five actual module round trips passed: localhost, IPv4 loopback, mesh.localhost, IPv6 loopback and HTTPS remote origin. Remote plaintext HTTP remains rejected. A retained regression was added to tests/tensormesh_invite_test.mjs (already called by CI). These checks ran directly against the production functions in the available Node runtime; they do not prove browser DNS resolution or native UI execution.

The first post-edit attempt reused a cached pre-edit module despite a changed import query, and still failed for mesh.localhost. Function source inspection proved that stale module. After resetting the Node kernel, the freshly imported function was checked for the updated condition and all five round trips plus the rejection passed. No cached result was counted as post-fix evidence.

## Required follow-up

Full Node test-runner execution, TypeScript/frontend rebuild, native rebuild and installer rebundling after this October 7 source correction remain NOT VERIFIED because shell process creation is unavailable. The October 6 installer does not contain this correction. Earlier UI/signaling evidence is in docs/tensormesh-rooms.md; it covers the default localhost flow, not this newly corrected alias.

The entire-repository audit remains incomplete. Outstanding gates include MoE terminal-exit diagnosis, native preview IPC isolation, release/installed-app checks and wider model/network inference coverage.

## Compiler API verification and test-runner limitation

Shell process creation was rechecked and failed with the same restricted-token sandbox configuration error. Direct ESM import of the installed CommonJS TypeScript entry returned an empty module namespace; loading it with the standard node:module createRequire API exposed the real installed TypeScript 5.9.3 compiler.

The actual tsconfig.json was read with TypeScript readConfigFile and parseJsonConfigFileContent against its real filesystem system. createProgram and getPreEmitDiagnostics checked the seven configured project root files with zero configuration or compiler diagnostics. This verifies current TypeScript source only; no frontend assets, native executable or installer were rebuilt. It started no shell or child process.

The actual node:test run API was inspected and confirmed to support isolation=none. Running tests/tensormesh_invite_test.mjs through that API timed out after 30 seconds, and the Node tool explicitly reset its kernel. No completed test summary was obtained, so the full Node suite remains NOT VERIFIED in this continuation. The timeout is a runner/tool limitation of unknown root cause, not a proven application failure. The earlier direct production-function round-trip checks remain separate evidence.
