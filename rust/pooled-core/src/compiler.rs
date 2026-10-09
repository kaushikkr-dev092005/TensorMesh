//! Conservative dispatch lowering followed by activation liveness planning.
//! Fusion is enabled only when the backend advertises a matching kernel.

use crate::graph::{Graph, GraphError, Node, Op, TensorId};
use crate::memory::{self, Limits, MemoryError, MemoryPlan};
use std::ops::Range;

#[derive(Clone, Copy, Debug, Default)]
pub struct FusionCapabilities {
    pub norm_qkv: bool,
    pub qkv_rope: bool,
    pub norm_qkv_rope: bool,
    pub output_residual: bool,
    pub down_residual: bool,
}

#[derive(Clone, Debug)]
pub struct Dispatch {
    /// Original graph nodes represented by this dispatch.
    pub source_nodes: Range<usize>,
    /// Preserve operand roles for kernel binding, including repeated skip inputs.
    pub original_nodes: Vec<Node>,
    pub node: Node,
}

#[derive(Clone, Debug)]
pub struct ExecutionPlan {
    pub graph: Graph,
    pub dispatches: Vec<Dispatch>,
    pub memory: MemoryPlan,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompileError {
    Graph(GraphError),
    Memory(MemoryError),
    InvalidRetainedTensor(TensorId),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IndirectError {
    DispatchCount,
    WorkgroupLimit(usize),
    SizeOverflow,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndirectTable {
    /// Upload with INDIRECT | COPY_DST. Each record is x, y, z in little endian.
    pub bytes: Vec<u8>,
    pub offsets: Vec<u64>,
}

impl ExecutionPlan {
    /// Geometry is supplied by kernel specialization. Position-dependent
    /// geometry can update this buffer without rebuilding the dispatch plan.
    pub fn indirect_table(
        &self,
        workgroups: &[[u32; 3]],
        max_workgroups_per_dimension: u32,
    ) -> Result<IndirectTable, IndirectError> {
        if workgroups.len() != self.dispatches.len() {
            return Err(IndirectError::DispatchCount);
        }
        let length = workgroups
            .len()
            .checked_mul(12)
            .ok_or(IndirectError::SizeOverflow)?;
        let mut table = IndirectTable {
            bytes: Vec::with_capacity(length),
            offsets: Vec::with_capacity(workgroups.len()),
        };
        for (index, dimensions) in workgroups.iter().enumerate() {
            if dimensions.iter().any(|&n| n > max_workgroups_per_dimension) {
                return Err(IndirectError::WorkgroupLimit(index));
            }
            table.offsets.push(table.bytes.len() as u64);
            for value in dimensions {
                table.bytes.extend(value.to_le_bytes());
            }
        }
        Ok(table)
    }
}

/// Lowers only adjacent, exclusively consumed transient intermediates. Retained
/// tensors and branches prevent fusion. Attention split and reduce remain
/// separate dispatches: there is no grid barrier inside a WebGPU workgroup.
pub fn compile(
    graph: &Graph,
    limits: Limits,
    retain: &[TensorId],
    capabilities: FusionCapabilities,
) -> Result<ExecutionPlan, CompileError> {
    graph.validate().map_err(CompileError::Graph)?;
    let mut consumers = vec![0usize; graph.tensors.len()];
    for node in &graph.nodes {
        for &id in &node.inputs {
            consumers[id] += 1;
        }
    }
    for &id in retain {
        if id >= graph.tensors.len()
            || graph.tensors[id].persistent
            || !graph.nodes.iter().any(|node| node.outputs.contains(&id))
        {
            return Err(CompileError::InvalidRetainedTensor(id));
        }
        // Treat a retained output as an additional consumer outside the graph.
        consumers[id] += 1;
    }
    let chain = |a: usize, b: usize| {
        let node = &graph.nodes[a];
        node.outputs.len() == 1
            && !graph.tensors[node.outputs[0]].persistent
            && consumers[node.outputs[0]] == 1
            && graph.nodes[b].inputs.contains(&node.outputs[0])
            && graph.nodes[b]
                .outputs
                .iter()
                .all(|&id| !graph.tensors[id].persistent)
    };
    let mut dispatches = Vec::new();
    let mut i = 0;
    while i < graph.nodes.len() {
        let mut end = i + 1;
        let mut op = graph.nodes[i].op.clone();
        if end < graph.nodes.len() && chain(i, end) {
            match (&graph.nodes[i].op, &graph.nodes[end].op) {
                (Op::RmsNorm, Op::Qkv) if capabilities.norm_qkv || capabilities.norm_qkv_rope => {
                    if capabilities.norm_qkv_rope
                        && end + 1 < graph.nodes.len()
                        && graph.nodes[end + 1].op == Op::Rope
                        && chain(end, end + 1)
                    {
                        op = Op::NormQkvRope;
                        end += 2;
                    } else if capabilities.norm_qkv {
                        op = Op::NormQkv;
                        end += 1;
                    }
                }
                (Op::Qkv, Op::Rope) if capabilities.qkv_rope => {
                    op = Op::QkvRope;
                    end += 1;
                }
                (Op::OutputProjection, Op::ResidualAdd)
                    if capabilities.output_residual && graph.nodes[end].inputs.len() == 2 =>
                {
                    op = Op::OutputProjectionResidual;
                    end += 1;
                }
                (Op::DownProjection, Op::ResidualAdd)
                    if capabilities.down_residual && graph.nodes[end].inputs.len() == 2 =>
                {
                    op = Op::DownProjectionResidual;
                    end += 1;
                }
                _ => {}
            }
        }
        let node = if end == i + 1 {
            graph.nodes[i].clone()
        } else {
            merged_node(&graph.nodes[i..end], op)
        };
        dispatches.push(Dispatch {
            source_nodes: i..end,
            original_nodes: graph.nodes[i..end].to_vec(),
            node,
        });
        i = end;
    }
    let lowered = Graph {
        tensors: graph.tensors.clone(),
        nodes: dispatches.iter().map(|d| d.node.clone()).collect(),
    };
    let memory = memory::plan(&lowered, limits, retain).map_err(CompileError::Memory)?;
    Ok(ExecutionPlan {
        graph: lowered,
        dispatches,
        memory,
    })
}

fn merged_node(nodes: &[Node], op: Op) -> Node {
    let mut produced = Vec::new();
    let mut inputs = Vec::new();
    for node in nodes {
        for &id in &node.inputs {
            if !produced.contains(&id) {
                inputs.push(id);
            }
        }
        produced.extend(&node.outputs);
    }
    Node {
        op,
        inputs,
        outputs: nodes.last().unwrap().outputs.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::Tensor;

    fn graph() -> Graph {
        Graph {
            tensors: (0..8)
                .map(|i| Tensor {
                    name: format!("t{i}"),
                    bytes: 1024,
                    persistent: i == 0,
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
        }
    }

    fn limits() -> Limits {
        Limits {
            max_buffer_size: 4096,
            max_storage_binding_size: 4096,
        }
    }
    fn caps() -> FusionCapabilities {
        FusionCapabilities {
            norm_qkv: true,
            qkv_rope: true,
            norm_qkv_rope: true,
            output_residual: true,
            down_residual: true,
        }
    }

    #[test]
    fn legal_fusions_remove_intermediates_and_keep_attention_barriers() {
        let p = compile(&graph(), limits(), &[7], caps()).unwrap();
        let ops: Vec<_> = p.graph.nodes.iter().map(|n| n.op.clone()).collect();
        assert_eq!(
            ops,
            vec![
                Op::NormQkvRope,
                Op::FlashDecodeSplit,
                Op::FlashDecodeReduce,
                Op::OutputProjectionResidual
            ]
        );
        assert_eq!(p.dispatches[0].source_nodes, 0..3);
        assert_eq!(p.graph.nodes[3].inputs, vec![5, 0]);
        assert!(p.memory.allocations[1].is_none());
        assert!(p.memory.allocations[2].is_none());
        assert!(p.memory.allocations[6].is_none());
        assert!(p.memory.allocations[7].is_some());
    }

    #[test]
    fn retained_intermediate_blocks_fusion() {
        let p = compile(&graph(), limits(), &[1, 7], caps()).unwrap();
        assert_eq!(p.graph.nodes[0].op, Op::RmsNorm);
        assert_eq!(p.graph.nodes[1].op, Op::QkvRope);
        assert!(p.memory.allocations[1].is_some());
    }

    #[test]
    fn branch_blocks_fusion() {
        let mut g = graph();
        g.tensors.push(Tensor {
            name: "branch".into(),
            bytes: 1024,
            persistent: false,
        });
        g.nodes.push(Node {
            op: Op::Copy,
            inputs: vec![2],
            outputs: vec![8],
        });
        let p = compile(&g, limits(), &[7, 8], caps()).unwrap();
        assert_eq!(p.graph.nodes[0].op, Op::NormQkv);
        assert_eq!(p.graph.nodes[1].op, Op::Rope);
        assert!(p.memory.allocations[2].is_some());
    }

    #[test]
    fn unavailable_backend_kernels_leave_dispatches_intact() {
        let g = graph();
        let p = compile(&g, limits(), &[7], FusionCapabilities::default()).unwrap();
        assert_eq!(p.dispatches.len(), g.nodes.len());
    }

    #[test]
    fn pair_kernels_do_not_imply_a_combined_kernel() {
        let p = compile(
            &graph(),
            limits(),
            &[7],
            FusionCapabilities {
                norm_qkv: true,
                qkv_rope: true,
                ..FusionCapabilities::default()
            },
        )
        .unwrap();
        assert_eq!(p.graph.nodes[0].op, Op::NormQkv);
        assert_eq!(p.graph.nodes[1].op, Op::Rope);
    }

    #[test]
    fn persistent_state_output_blocks_fusion() {
        let mut g = graph();
        g.tensors[2].persistent = true;
        let p = compile(&g, limits(), &[7], caps()).unwrap();
        assert_eq!(p.graph.nodes[0].op, Op::RmsNorm);
        assert_eq!(p.graph.nodes[1].op, Op::Qkv);
        assert_eq!(p.graph.nodes[2].op, Op::Rope);
    }

    #[test]
    fn down_projection_residual_keeps_skip_input() {
        let mut g = graph();
        g.nodes = vec![
            Node {
                op: Op::DownProjection,
                inputs: vec![0],
                outputs: vec![1],
            },
            Node {
                op: Op::ResidualAdd,
                inputs: vec![1, 0],
                outputs: vec![2],
            },
        ];
        let p = compile(&g, limits(), &[2], caps()).unwrap();
        assert_eq!(p.graph.nodes.len(), 1);
        assert_eq!(p.graph.nodes[0].op, Op::DownProjectionResidual);
        assert_eq!(p.graph.nodes[0].inputs, vec![0, 0]);
        assert_eq!(p.graph.nodes[0].outputs, vec![2]);
    }

    #[test]
    fn indirect_records_match_dispatch_order_and_device_limit() {
        let p = compile(&graph(), limits(), &[7], caps()).unwrap();
        let table = p
            .indirect_table(&[[2, 1, 1], [4, 2, 1], [1, 1, 1], [8, 1, 1]], 8)
            .unwrap();
        assert_eq!(table.offsets, vec![0, 12, 24, 36]);
        assert_eq!(&table.bytes[12..16], &4u32.to_le_bytes());
        assert_eq!(
            p.indirect_table(&[[9, 1, 1]; 4], 8),
            Err(IndirectError::WorkgroupLimit(0))
        );
        assert_eq!(
            p.indirect_table(&[[1, 1, 1]], 8),
            Err(IndirectError::DispatchCount)
        );
    }
}
