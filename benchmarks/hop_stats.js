// Compact, deterministic summaries for the hop probe and benchmark reports.
export function summarize(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("samples must be nonempty finite nonnegative numbers");
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (p) => {
    const at = (sorted.length - 1) * p;
    const lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  };
  return { n: sorted.length, min: sorted[0], p50: quantile(0.5), p90: quantile(0.9), max: sorted.at(-1), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
}
