//! CPU-only planning primitives for a future native and wasm Pooled executor.
//! The browser engine remains the correctness and performance baseline.

pub mod compiler;
pub mod graph;
pub mod memory;
pub mod placement;
pub mod q4;
pub mod roofline;
pub mod speculation;
