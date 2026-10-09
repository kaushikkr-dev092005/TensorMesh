//! Inspect a synthetic attention block's legal dispatch and memory lowering.
use pooled_core::{
    compiler::{compile, FusionCapabilities},
    graph::{Graph, Node, Op, Tensor},
    memory::Limits,
};

fn main() {
    let graph = Graph {
        tensors: (0..8)
            .map(|id| Tensor {
                name: format!("activation_{id}"),
                bytes: 5120 * 4,
                persistent: id == 0,
            })
            .collect(),
        nodes: vec![
            Node {
                op: Op::RmsNorm,
                inputs: vec![0],
                outputs: vec![1],
            },
            Node {
                op: Op::Qkv,
                inputs: vec![1],
                outputs: vec![2],
            },
            Node {
                op: Op::Rope,
                inputs: vec![2],
                outputs: vec![3],
            },
            Node {
                op: Op::FlashDecodeSplit,
                inputs: vec![3],
                outputs: vec![4],
            },
            Node {
                op: Op::FlashDecodeReduce,
                inputs: vec![4],
                outputs: vec![5],
            },
            Node {
                op: Op::OutputProjection,
                inputs: vec![5],
                outputs: vec![6],
            },
            Node {
                op: Op::ResidualAdd,
                inputs: vec![6, 0],
                outputs: vec![7],
            },
        ],
    };
    let limits = Limits {
        max_buffer_size: 64 * 1024,
        max_storage_binding_size: 64 * 1024,
    };
    let baseline = compile(&graph, limits, &[7], FusionCapabilities::default()).unwrap();
    // These capabilities are illustrative; the native backend does not yet
    // advertise fused kernels. Real geometry comes from kernel specialization.
    let fused = compile(
        &graph,
        limits,
        &[7],
        FusionCapabilities {
            norm_qkv: true,
            qkv_rope: true,
            norm_qkv_rope: true,
            output_residual: true,
            down_residual: false,
        },
    )
    .unwrap();
    println!(
        "dispatches: {} -> {}",
        baseline.dispatches.len(),
        fused.dispatches.len()
    );
    for (index, dispatch) in fused.dispatches.iter().enumerate() {
        println!(
            "{index}: {:?}, source {:?}, inputs {:?}, outputs {:?}",
            dispatch.node.op, dispatch.source_nodes, dispatch.node.inputs, dispatch.node.outputs
        );
    }
    println!("activation buffers: {:?}", fused.memory.arenas);
    for (id, allocation) in fused.memory.allocations.iter().enumerate() {
        if let Some(a) = allocation {
            println!(
                "tensor {id}: buffer {}, offset {}, bytes {}",
                a.arena, a.offset, a.bytes
            );
        }
    }
}
