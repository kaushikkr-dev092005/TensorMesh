//! Select draft depth from measured verification and transport times.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DraftChoice {
    pub depth: usize,
    pub expected_tokens: f64,
    pub expected_tokens_per_second: f64,
}

/// K draft tokens allow at most K+1 accepted output tokens in a round.
pub fn expected_tokens(acceptance: f64, depth: usize) -> Option<f64> {
    if !acceptance.is_finite() || !(0.0..=1.0).contains(&acceptance) {
        return None;
    }
    if acceptance == 1.0 {
        return Some((depth + 1) as f64);
    }
    Some((1.0 - acceptance.powf((depth + 1) as f64)) / (1.0 - acceptance))
}

/// Each `(K, verify_ms)` point must be measured on the target pipeline.
pub fn choose_depth(
    acceptance: f64,
    rtt_ms: f64,
    measured: &[(usize, f64)],
) -> Option<DraftChoice> {
    if !rtt_ms.is_finite() || rtt_ms < 0.0 {
        return None;
    }
    measured
        .iter()
        .filter_map(|&(depth, verify_ms)| {
            if !verify_ms.is_finite() || verify_ms < 0.0 || verify_ms + rtt_ms <= 0.0 {
                return None;
            }
            let tokens = expected_tokens(acceptance, depth)?;
            Some(DraftChoice {
                depth,
                expected_tokens: tokens,
                expected_tokens_per_second: tokens * 1000.0 / (verify_ms + rtt_ms),
            })
        })
        .max_by(|a, b| {
            a.expected_tokens_per_second
                .total_cmp(&b.expected_tokens_per_second)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diminishing_returns_at_eighty_percent() {
        let k8 = expected_tokens(0.8, 8).unwrap();
        let k16 = expected_tokens(0.8, 16).unwrap();
        assert!((k8 - 4.3289).abs() < 0.001);
        assert!((k16 - 4.8874).abs() < 0.001);
        assert_eq!(
            choose_depth(0.8, 10.0, &[(8, 20.0), (16, 40.0)])
                .unwrap()
                .depth,
            8
        );
    }
}
