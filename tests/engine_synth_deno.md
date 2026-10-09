# Standalone synthetic GPU audit

Run from the repository root with Deno WebGPU support and a working GPU adapter:

```powershell
node tests/e2e/synth.mjs ./hybrid-synth.gguf
deno run --unstable-webgpu --allow-read --allow-env tests/engine_synth_deno.js ./hybrid-synth.gguf
```

The default driver runs the existing `engine_synth.mjs` test body: 40 tokens, batch widths 4/16, speculative K=1/3/7 and two/three-stage partitions. It prints each check and exits nonzero if any completed assertion fails. A process termination without the final JSON summary is incomplete, regardless of earlier PASS lines.

It exercises the actual JavaScript engine, GGUF loader and GPU kernels on a seeded synthetic hybrid model. It does not verify pretrained model quality, llama.cpp parity, Rust full-model execution, browser permissions or networked peers. Layer partitions share one GPU and execute sequentially.

For an MoE fixture:

```powershell
node tests/e2e/synth.mjs ./moe-synth.gguf --moe
deno run --unstable-webgpu --allow-read --allow-env tests/engine_synth_deno.js ./moe-synth.gguf
```

October 5 Windows audit: the default hybrid fixture completed all 45 checks. Draft-cache continuation warnings remain unresolved. The MoE run terminated with exit code -1 before its summary; full MoE coverage remains NOT VERIFIED.

The sampler now rejects empty/non-finite logits before selecting a token. Run `node tests/checked_argmax_test.mjs` for seven CPU regression cases. October 6 guard checks passed; full GPU execution after this correction remains NOT VERIFIED.
