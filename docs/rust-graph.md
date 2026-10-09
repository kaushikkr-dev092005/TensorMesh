# Rust graph compiler contract

The native path compiles an ordered graph before allocating transient GPU buffers. `compiler::compile` validates dependencies, lowers permitted adjacent fusions, retains original node ranges and operand lists for kernel binding, and runs the liveness planner on the resulting dispatch graph. External operand occurrences remain in source order, including a skip input that aliases the projection input. Tensor IDs stay stable. Eliminated intermediates keep their IDs in the tensor registry but have no GPU allocation.

The current graph describes dependencies and byte sizes. It does not contain transformer shape, precision, or quantization metadata, so a backend must validate those before advertising a fusion capability. All capabilities default to disabled. Each flag asserts that the backend has a compatible kernel for the supplied nodes. Support for norm/QKV and QKV/RoPE separately does not imply support for a combined norm/QKV/RoPE kernel; the combined kernel has its own flag.

## Permitted lowering

| Source operations | Dispatch operation | Required kernel capability |
| --- | --- | --- |
| RMSNorm, QKV | NormQkv | `norm_qkv` |
| QKV, RoPE | QkvRope | `qkv_rope` |
| RMSNorm, QKV, RoPE | NormQkvRope | `norm_qkv_rope` |
| Output projection, residual add | OutputProjectionResidual | `output_residual` |
| Down projection, residual add | DownProjectionResidual | `down_residual` |

The compiler eliminates an intermediate only when it is transient, has one consumer, and is not retained by the caller. Fusions require adjacent nodes; any additional use or branch preserves the intermediate. Persistent state writes are not fused. The residual add must have two inputs. The compiler does not fuse attention split, attention reduction, or output projection across those dispatch boundaries.

The norm/QKV kernel contract recomputes the norm within each QKV workgroup. RoPE is a QKV epilogue. Residual addition is a projection epilogue. These contracts avoid grid-wide synchronization; they still require actual kernel implementation and CPU/GPU parity tests before a backend enables the corresponding flags. Existing `GateUpSilu` remains a pre-fused graph operation.

## Buffers and indirect dispatch

Activation allocation runs after lowering, so removed intermediates consume no arena space. The native probe source uses the returned arena index, 256-byte aligned offset, and exact tensor binding size. Persistent weights, external inputs, KV, and recurrent state remain outside this planner.

`ExecutionPlan::indirect_table` accepts one workgroup geometry per dispatch and rejects values exceeding the adapter's per-dimension limit. It emits x/y/z u32 values as 12-byte records with offsets aligned to four bytes, suitable for `dispatchWorkgroupsIndirect`. Updating indirect arguments changes geometry; it does not by itself eliminate command encoding or update model position uniforms. Those executor features remain to be implemented.

The dependency example can be run with `cargo run --manifest-path rust/Cargo.toml -p pooled-core --example compile_graph`. It illustrates lowering and memory reuse using synthetic tensors; its dispatch count is not a model-wide performance claim. The Linux CI definition compiles both Rust crates and runs CPU tests without requiring a GPU. Native shader execution and full-model parity are separate gates.
