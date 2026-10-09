# TensorMesh audit — October 6

## Execution limitation

The shell runner refused the first process with:

```text
UnsupportedOperation("windows unelevated restricted-token sandbox cannot enforce split writable root sets directly; refusing to run unsandboxed")
```

No process inventory, build or GPU rerun executed. The patch tool also failed to write this report; this file was saved through the available Node filesystem API inside the permitted workspace. No unsandboxed shell workaround was attempted.

## Source audit

Re-read current manifests, command registration, capabilities, preview frames and the installed Tauri 2.12.1 source. The app registers eight commands and initializes only the dialog plugin. The main-window capability grants core defaults and dialog open, with no remote context. The preview host is managed Rust state; the registry retains its companion file lock.

Installed Tauri source at src/webview/mod.rs:2007 derives local/remote status from InvokeRequest.url, checks the invoke key, resolves command access, and rejects unresolved remote commands before the application handler. src/ipc/protocol.rs:305 derives the post-message URL from the runtime request URI. These are source guarantees of intended enforcement; actual frame origin attribution and native preview fallback denial remain NOT VERIFIED. Both preview frames retain allow-scripts-only sandboxing.

The root unit directory contains 90 JavaScript files including helpers and standalone smoke scripts, not 90 passing tests. CI has separate Deno, Node CLI, generator and browser gates. The desktop workflow separately checks the frontend, native host and release installer. Workflow execution is NOT VERIFIED.

## Remaining gates

- Restore enforceable shell execution and inspect live processes before restarting interrupted work.
- Complete MoE execution or establish the terminal exit -1 root cause.
- Observe definitive untrusted preview IPC denial for each available transport; callback timeout is inconclusive.
- Verify release build, installation/uninstall and installed app launch.
- Complete repository suites, real model/distributed inference and investigate the draft-cache warning.

The previous completed turn generated the debug installer. Earlier evidence is in [the October 4–5 report](verification-2026-10-04.md). Full completion remains unproven; the goal stays active.

## Synthetic logit oracle correction

The synthetic GPU check labeled "no NaN" examined integer token IDs only. Production argmax returns index 0 for all-NaN logits, demonstrated directly against engine/sampling.js. The harness now imports tests/checked_argmax.js and rejects empty/non-finite logits before plain/speculative sampling. Production sampling is unchanged.

Seven retained regression cases in tests/checked_argmax_test.mjs passed by importing and invoking its actual verification function in the available Node runner: finite winner, tie, empty input, all-NaN, trailing NaN, positive/negative infinity. Initial module import failed because the runner lacks global process; node:process was also denied. The CLI entry condition now checks whether process exists, and the retained verification function then passed without requiring that API. Reproduce with `node tests/checked_argmax_test.mjs`. Full synthetic GPU execution after this change remains NOT VERIFIED because the shell sandbox runner is unavailable. Earlier 45-check results do not prove the new finite-logit gate.

## CI regression gate

The retained seven-case logit guard regression was not called by the existing workflow. Added an explicit Node step before the Deno unit suite in .github/workflows/ci.yml. The actual exported verification function passed seven checks again after the gate was saved, and the exact step was read back. GitHub workflow execution and full GPU rerun remain NOT VERIFIED. Shell process creation still fails with the same restricted-token sandbox configuration error.
