//! Offline activation allocation. Persistent weights and model state are separate.

use crate::graph::{Graph, GraphError, TensorId};

pub const STORAGE_ALIGNMENT: u64 = 256;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_buffer_size: u64,
    pub max_storage_binding_size: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Allocation {
    pub arena: usize,
    pub offset: u64,
    /// The original tensor size. The reserved interval is aligned to 256 bytes.
    pub bytes: u64,
}

#[derive(Clone, Debug)]
pub struct MemoryPlan {
    pub arenas: Vec<u64>,
    pub allocations: Vec<Option<Allocation>>,
    pub peak_reserved_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemoryError {
    Graph(GraphError),
    InvalidLimit,
    BindingTooLarge(TensorId),
    InvalidRetainedTensor(TensorId),
    SizeOverflow(TensorId),
}

#[derive(Clone, Copy)]
struct Hole {
    arena: usize,
    offset: u64,
    bytes: u64,
}

fn aligned(bytes: u64) -> Option<u64> {
    bytes
        .checked_add(STORAGE_ALIGNMENT - 1)
        .map(|v| v & !(STORAGE_ALIGNMENT - 1))
}

/// `retain` names transient graph outputs needed after the last dispatch.
pub fn plan(graph: &Graph, limits: Limits, retain: &[TensorId]) -> Result<MemoryPlan, MemoryError> {
    graph.validate().map_err(MemoryError::Graph)?;
    if limits.max_buffer_size < STORAGE_ALIGNMENT || limits.max_storage_binding_size == 0 {
        return Err(MemoryError::InvalidLimit);
    }
    let mut last_use = vec![None; graph.tensors.len()];
    for (step, node) in graph.nodes.iter().enumerate() {
        for &id in &node.outputs {
            last_use[id] = Some(step);
        }
        for &id in &node.inputs {
            if !graph.tensors[id].persistent {
                last_use[id] = Some(step);
            }
        }
    }
    for &id in retain {
        if id >= graph.tensors.len() || graph.tensors[id].persistent || last_use[id].is_none() {
            return Err(MemoryError::InvalidRetainedTensor(id));
        }
        last_use[id] = Some(graph.nodes.len());
    }

    let mut result = MemoryPlan {
        arenas: Vec::new(),
        allocations: vec![None; graph.tensors.len()],
        peak_reserved_bytes: 0,
    };
    let mut free = Vec::<Hole>::new();
    let mut live = Vec::<(TensorId, usize)>::new();
    let mut live_bytes = 0u64;
    for (step, node) in graph.nodes.iter().enumerate() {
        // Keep inputs alive until this dispatch has completed. Reuse begins next dispatch.
        let mut i = 0;
        while i < live.len() {
            if live[i].1 < step {
                let id = live.swap_remove(i).0;
                let a = result.allocations[id].unwrap();
                let reserved = aligned(a.bytes).unwrap();
                live_bytes -= reserved;
                free.push(Hole {
                    arena: a.arena,
                    offset: a.offset,
                    bytes: reserved,
                });
            } else {
                i += 1;
            }
        }
        coalesce(&mut free);
        for &id in &node.outputs {
            let tensor = &graph.tensors[id];
            if tensor.persistent {
                continue;
            }
            if tensor.bytes > limits.max_storage_binding_size {
                return Err(MemoryError::BindingTooLarge(id));
            }
            let reserved = aligned(tensor.bytes).ok_or(MemoryError::SizeOverflow(id))?;
            if reserved > limits.max_buffer_size {
                return Err(MemoryError::BindingTooLarge(id));
            }
            let best = free
                .iter()
                .enumerate()
                .filter(|(_, hole)| hole.bytes >= reserved)
                .min_by_key(|(_, hole)| hole.bytes)
                .map(|(index, _)| index);
            let (arena, offset) = if let Some(index) = best {
                let hole = &mut free[index];
                let position = (hole.arena, hole.offset);
                hole.offset += reserved;
                hole.bytes -= reserved;
                if hole.bytes == 0 {
                    free.swap_remove(index);
                }
                position
            } else if let Some((index, size)) = result
                .arenas
                .iter_mut()
                .enumerate()
                .find(|(_, size)| limits.max_buffer_size - **size >= reserved)
            {
                let offset = *size;
                *size += reserved;
                (index, offset)
            } else {
                result.arenas.push(reserved);
                (result.arenas.len() - 1, 0)
            };
            result.allocations[id] = Some(Allocation {
                arena,
                offset,
                bytes: tensor.bytes,
            });
            live.push((id, last_use[id].unwrap()));
            live_bytes += reserved;
            result.peak_reserved_bytes = result.peak_reserved_bytes.max(live_bytes);
        }
    }
    Ok(result)
}

fn coalesce(free: &mut Vec<Hole>) {
    free.sort_by_key(|h| (h.arena, h.offset));
    let mut merged: Vec<Hole> = Vec::with_capacity(free.len());
    for hole in free.drain(..) {
        if let Some(last) = merged.last_mut() {
            if last.arena == hole.arena && last.offset + last.bytes == hole.offset {
                last.bytes += hole.bytes;
                continue;
            }
        }
        merged.push(hole);
    }
    *free = merged;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{Node, Op, Tensor};

    fn tensor(name: &str, bytes: u64) -> Tensor {
        Tensor {
            name: name.into(),
            bytes,
            persistent: false,
        }
    }

    #[test]
    fn reuses_dead_activations_but_not_same_dispatch_inputs() {
        let graph = Graph {
            tensors: vec![tensor("a", 300), tensor("b", 300), tensor("c", 300)],
            nodes: vec![
                Node {
                    op: Op::Copy,
                    inputs: vec![],
                    outputs: vec![0],
                },
                Node {
                    op: Op::Copy,
                    inputs: vec![0],
                    outputs: vec![1],
                },
                Node {
                    op: Op::Copy,
                    inputs: vec![1],
                    outputs: vec![2],
                },
            ],
        };
        let p = plan(
            &graph,
            Limits {
                max_buffer_size: 1024,
                max_storage_binding_size: 512,
            },
            &[2],
        )
        .unwrap();
        assert_ne!(p.allocations[0], p.allocations[1]);
        assert_eq!(p.allocations[0], p.allocations[2]);
        assert_eq!(p.peak_reserved_bytes, 1024);
    }

    #[test]
    fn splits_arenas_at_device_limit() {
        let graph = Graph {
            tensors: vec![tensor("a", 500), tensor("b", 500), tensor("c", 500)],
            nodes: vec![Node {
                op: Op::Copy,
                inputs: vec![],
                outputs: vec![0, 1, 2],
            }],
        };
        let p = plan(
            &graph,
            Limits {
                max_buffer_size: 1024,
                max_storage_binding_size: 512,
            },
            &[0, 1, 2],
        )
        .unwrap();
        assert_eq!(p.arenas, vec![1024, 512]);
        assert!(p.allocations.iter().flatten().all(|a| a.offset % 256 == 0));
    }

    #[test]
    fn enforces_binding_limit() {
        let graph = Graph {
            tensors: vec![tensor("large", 513)],
            nodes: vec![Node {
                op: Op::Copy,
                inputs: vec![],
                outputs: vec![0],
            }],
        };
        assert_eq!(
            plan(
                &graph,
                Limits {
                    max_buffer_size: 2048,
                    max_storage_binding_size: 512
                },
                &[]
            )
            .unwrap_err(),
            MemoryError::BindingTooLarge(0)
        );
    }
}
