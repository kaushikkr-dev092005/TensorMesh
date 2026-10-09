fn main() {
    let assets = std::path::Path::new("../dist");
    assert!(
        assets.join("runtime/tensormesh-config.json").is_file(),
        "Build the TensorMesh frontend before compiling the desktop app"
    );
    check_assets(assets);
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}

fn check_assets(directory: &std::path::Path) {
    let legacy_host = ["pooled", "run"].join(".");
    for entry in std::fs::read_dir(directory).expect("Read packaged frontend assets") {
        let path = entry.expect("Read frontend asset entry").path();
        if path.is_dir() {
            check_assets(&path);
        } else if matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("html" | "js" | "json" | "svg" | "css" | "md" | "webmanifest")
        ) {
            let source = std::fs::read_to_string(&path).expect("Read packaged frontend text");
            assert!(
                !source.to_lowercase().contains(&legacy_host)
                    && !source.contains("github.com/Nehanth/pooled"),
                "Legacy upstream routing in desktop asset: {}",
                path.display()
            );
        }
    }
}
