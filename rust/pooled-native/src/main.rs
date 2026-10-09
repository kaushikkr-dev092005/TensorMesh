fn main() {
    let iterations = std::env::args()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);
    match pooled_native::run_probe(iterations) {
        Ok(r) => println!("adapter={} backend={} rows={} cols={} iterations={} avg_wall_ms={:.4} max_abs_error={:.6}", r.adapter, r.backend, r.rows, r.cols, r.iterations, r.average_wall_ms, r.max_abs_error),
        Err(error) => { eprintln!("pooled-native: {error}"); std::process::exit(1); }
    }
}
