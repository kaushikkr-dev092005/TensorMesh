//! Exact contiguous pipeline placement for one ordered chain and one token stream.

#[derive(Clone, Debug)]
pub struct Device {
    pub name: String,
    pub weight_capacity_bytes: u64,
    /// Measured decode time for each layer on this device.
    pub layer_ms: Vec<f64>,
    pub stage_overhead_ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Stage {
    pub device: usize,
    pub first_layer: usize,
    pub end_layer: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub stages: Vec<Stage>,
    pub estimated_ms_per_token: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlacementError {
    InvalidInput,
    NoFeasiblePlacement,
}

#[derive(Clone)]
struct State {
    cost: f64,
    stages: Vec<Stage>,
}

/// Device 0 is the model host and must hold at least one layer. Devices may be
/// skipped, but their order is fixed. `hop_ms[i][j]` includes GPU readback,
/// transport, upload, and any fixed serialization cost for a hidden-state hop.
/// The returned latency estimate does not claim single-stream pipeline speedup.
pub fn place(
    layer_bytes: &[u64],
    devices: &[Device],
    hop_ms: &[Vec<f64>],
) -> Result<Placement, PlacementError> {
    let n = layer_bytes.len();
    let d = devices.len();
    if n == 0
        || d == 0
        || layer_bytes.contains(&0)
        || hop_ms.len() != d
        || hop_ms
            .iter()
            .any(|row| row.len() != d || row.iter().any(|v| !v.is_finite() || *v < 0.0))
        || devices.iter().any(|dev| {
            dev.layer_ms.len() != n
                || !dev.stage_overhead_ms.is_finite()
                || dev.stage_overhead_ms < 0.0
                || dev.layer_ms.iter().any(|v| !v.is_finite() || *v < 0.0)
        })
    {
        return Err(PlacementError::InvalidInput);
    }
    let mut dp = vec![vec![None::<State>; d]; n + 1];
    for end in 1..=n {
        if let Some(cost) = segment_cost(layer_bytes, &devices[0], 0, end) {
            dp[end][0] = Some(State {
                cost,
                stages: vec![Stage {
                    device: 0,
                    first_layer: 0,
                    end_layer: end,
                }],
            });
        }
    }
    for current in 1..d {
        let mut next = dp.clone(); // skipping this device is allowed
        for end in 2..=n {
            for start in 1..end {
                let Some(stage_cost) = segment_cost(layer_bytes, &devices[current], start, end)
                else {
                    continue;
                };
                for previous in 0..current {
                    let Some(state) = &dp[start][previous] else {
                        continue;
                    };
                    let cost = state.cost + hop_ms[previous][current] + stage_cost;
                    if next[end][current]
                        .as_ref()
                        .is_none_or(|best| cost < best.cost)
                    {
                        let mut stages = state.stages.clone();
                        stages.push(Stage {
                            device: current,
                            first_layer: start,
                            end_layer: end,
                        });
                        next[end][current] = Some(State { cost, stages });
                    }
                }
            }
        }
        dp = next;
    }
    let best = dp[n]
        .iter()
        .flatten()
        .min_by(|a, b| a.cost.total_cmp(&b.cost))
        .ok_or(PlacementError::NoFeasiblePlacement)?;
    Ok(Placement {
        stages: best.stages.clone(),
        estimated_ms_per_token: best.cost,
    })
}

fn segment_cost(layer_bytes: &[u64], device: &Device, start: usize, end: usize) -> Option<f64> {
    let bytes = layer_bytes[start..end]
        .iter()
        .try_fold(0u64, |sum, &v| sum.checked_add(v))?;
    if bytes > device.weight_capacity_bytes {
        return None;
    }
    Some(device.stage_overhead_ms + device.layer_ms[start..end].iter().sum::<f64>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_fast_peer_only_when_hop_pays() {
        let devices = vec![
            Device {
                name: "host".into(),
                weight_capacity_bytes: 40,
                layer_ms: vec![3.0; 4],
                stage_overhead_ms: 0.0,
            },
            Device {
                name: "peer".into(),
                weight_capacity_bytes: 30,
                layer_ms: vec![1.0; 4],
                stage_overhead_ms: 0.0,
            },
        ];
        let p = place(&[10; 4], &devices, &[vec![0.0, 1.0], vec![0.0; 2]]).unwrap();
        assert_eq!(
            p.stages,
            vec![
                Stage {
                    device: 0,
                    first_layer: 0,
                    end_layer: 1
                },
                Stage {
                    device: 1,
                    first_layer: 1,
                    end_layer: 4
                }
            ]
        );
        assert_eq!(p.estimated_ms_per_token, 7.0);
        let p = place(&[10; 4], &devices, &[vec![0.0, 20.0], vec![0.0; 2]]).unwrap();
        assert_eq!(p.stages.len(), 1);
    }

    #[test]
    fn rejects_insufficient_memory() {
        let devices = vec![Device {
            name: "host".into(),
            weight_capacity_bytes: 1,
            layer_ms: vec![1.0],
            stage_overhead_ms: 0.0,
        }];
        assert_eq!(
            place(&[2], &devices, &[vec![0.0]]),
            Err(PlacementError::NoFeasiblePlacement)
        );
    }
}
