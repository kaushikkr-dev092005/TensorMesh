//! A lower bound, not a throughput prediction. Calibrate with measured GPU values.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Roofline {
    pub memory_ms: f64,
    pub compute_ms: f64,
    pub dispatch_ms: f64,
    pub lower_bound_ms: f64,
    pub measured_over_lower_bound: f64,
}

/// `bytes_moved` includes actual weight, activation, and KV traffic. Bandwidth
/// and FLOP/s are measured sustained values for the selected kernel family.
pub fn estimate(
    bytes_moved: u64,
    flops: f64,
    bandwidth_bytes_per_second: f64,
    sustained_flops_per_second: f64,
    dispatches: u32,
    dispatch_floor_ms: f64,
    measured_ms: f64,
) -> Option<Roofline> {
    if !flops.is_finite()
        || flops < 0.0
        || !bandwidth_bytes_per_second.is_finite()
        || bandwidth_bytes_per_second <= 0.0
        || !sustained_flops_per_second.is_finite()
        || sustained_flops_per_second <= 0.0
        || !dispatch_floor_ms.is_finite()
        || dispatch_floor_ms < 0.0
        || !measured_ms.is_finite()
        || measured_ms <= 0.0
    {
        return None;
    }
    let memory_ms = bytes_moved as f64 * 1000.0 / bandwidth_bytes_per_second;
    let compute_ms = flops * 1000.0 / sustained_flops_per_second;
    let dispatch_ms = dispatches as f64 * dispatch_floor_ms;
    let lower_bound_ms = memory_ms.max(compute_ms).max(dispatch_ms);
    if lower_bound_ms == 0.0 {
        return None;
    }
    Some(Roofline {
        memory_ms,
        compute_ms,
        dispatch_ms,
        lower_bound_ms,
        measured_over_lower_bound: measured_ms / lower_bound_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_bound_path_has_little_headroom() {
        let r = estimate(15_000_000_000, 1e12, 1e12, 1e15, 400, 0.001, 16.0).unwrap();
        assert_eq!(r.memory_ms, 15.0);
        assert_eq!(r.lower_bound_ms, 15.0);
        assert!((r.measured_over_lower_bound - 16.0 / 15.0).abs() < 1e-12);
    }
}
