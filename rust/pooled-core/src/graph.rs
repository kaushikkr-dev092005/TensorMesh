//! A dispatch graph describes dependencies, including hybrid model operations.

use std::collections::HashSet;

pub type TensorId = usize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    RmsNorm,
    QuantizedMatvec,
    Qkv,
    Rope,
    FlashDecodeSplit,
    FlashDecodeReduce,
    OutputProjection,
    GateUpSilu,
    DownProjection,
    MoeRoute,
    MoeExperts,
    DeltaNet,
    Conv1d,
    Gating,
    ResidualAdd,
    NormQkv,
    QkvRope,
    NormQkvRope,
    OutputProjectionResidual,
    DownProjectionResidual,
    Copy,
}

#[derive(Clone, Debug)]
pub struct Tensor {
    pub name: String,
    pub bytes: u64,
    /// Persistent state (weights, KV, recurrent state) is outside the activation arena.
    pub persistent: bool,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub op: Op,
    pub inputs: Vec<TensorId>,
    pub outputs: Vec<TensorId>,
}

#[derive(Clone, Debug, Default)]
pub struct Graph {
    pub tensors: Vec<Tensor>,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GraphError {
    InvalidTensor(TensorId),
    DuplicateProducer(TensorId),
    ReadBeforeWrite(TensorId),
    ZeroSizedTensor(TensorId),
    NoOutputs(usize),
}

impl Graph {
    /// Nodes are in dispatch order. Every transient input must be produced earlier.
    pub fn validate(&self) -> Result<(), GraphError> {
        let mut produced = HashSet::new();
        for (id, tensor) in self.tensors.iter().enumerate() {
            if tensor.bytes == 0 {
                return Err(GraphError::ZeroSizedTensor(id));
            }
        }
        for (index, node) in self.nodes.iter().enumerate() {
            if node.outputs.is_empty() {
                return Err(GraphError::NoOutputs(index));
            }
            for &id in &node.inputs {
                let tensor = self.tensors.get(id).ok_or(GraphError::InvalidTensor(id))?;
                if !tensor.persistent && !produced.contains(&id) {
                    return Err(GraphError::ReadBeforeWrite(id));
                }
            }
            for &id in &node.outputs {
                let tensor = self.tensors.get(id).ok_or(GraphError::InvalidTensor(id))?;
                if !tensor.persistent && !produced.insert(id) {
                    return Err(GraphError::DuplicateProducer(id));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_state_can_be_updated_more_than_once() {
        let graph = Graph {
            tensors: vec![Tensor {
                name: "kv".into(),
                bytes: 1024,
                persistent: true,
            }],
            nodes: vec![
                Node {
                    op: Op::Copy,
                    inputs: vec![0],
                    outputs: vec![0],
                },
                Node {
                    op: Op::Copy,
                    inputs: vec![0],
                    outputs: vec![0],
                },
            ],
        };
        assert_eq!(graph.validate(), Ok(()));
    }

    #[test]
    fn transient_read_requires_prior_producer() {
        let graph = Graph {
            tensors: vec![Tensor {
                name: "x".into(),
                bytes: 16,
                persistent: false,
            }],
            nodes: vec![Node {
                op: Op::Copy,
                inputs: vec![0],
                outputs: vec![0],
            }],
        };
        assert_eq!(graph.validate(), Err(GraphError::ReadBeforeWrite(0)));
    }
}
