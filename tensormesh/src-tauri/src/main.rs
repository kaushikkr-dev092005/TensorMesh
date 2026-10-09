mod preview;
use pooled_core::{
    compiler::{compile, FusionCapabilities},
    graph::{Graph, Node, Op, Tensor},
    memory::Limits,
    speculation,
};
use serde::Serialize;
use std::{fs, io::Read};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Adapter {
    name: String,
    backend: String,
    device_type: String,
    max_buffer_bytes: u64,
    max_binding_bytes: u32,
}
#[tauri::command]
fn devices() -> Vec<Adapter> {
    wgpu::Instance::default()
        .enumerate_adapters(wgpu::Backends::all())
        .into_iter()
        .map(|a| {
            let i = a.get_info();
            let l = a.limits();
            Adapter {
                name: i.name,
                backend: format!("{:?}", i.backend),
                device_type: format!("{:?}", i.device_type),
                max_buffer_bytes: l.max_buffer_size,
                max_binding_bytes: l.max_storage_buffer_binding_size,
            }
        })
        .collect()
}
#[tauri::command]
async fn gpu_probe(iterations: u32) -> Result<serde_json::Value, String> {
    if !(1..=1000).contains(&iterations) {
        return Err("Choose 1–1000 iterations".into());
    }
    tauri::async_runtime::spawn_blocking(move || pooled_native::run_probe(iterations).map(|r| serde_json::json!({"adapter":r.adapter,"backend":r.backend,"rows":r.rows,"cols":r.cols,"iterations":r.iterations,"averageWallMs":r.average_wall_ms,"maxAbsError":r.max_abs_error})).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn graph_plan(hidden: u32, max_buffer_mb: u32) -> Result<serde_json::Value, String> {
    if !(64..=65536).contains(&hidden) || !(1..=4096).contains(&max_buffer_mb) {
        return Err("Hidden width must be 64–65536; buffer limit 1–4096 MiB".into());
    }
    let graph = Graph {
        tensors: (0..8)
            .map(|id| Tensor {
                name: format!("activation_{id}"),
                bytes: u64::from(hidden) * 4,
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
    // No fusion is advertised until kernels pass their correctness gates.
    let c = compile(
        &graph,
        Limits {
            max_buffer_size: u64::from(max_buffer_mb) * 1024 * 1024,
            max_storage_binding_size: u64::from(max_buffer_mb) * 1024 * 1024,
        },
        &[7],
        FusionCapabilities::default(),
    )
    .map_err(|e| format!("{e:?}"))?;
    Ok(
        serde_json::json!({"dispatches":c.dispatches.len(),"arenas":c.memory.arenas,"reservedBytes":c.memory.peak_reserved_bytes,"nodes":c.dispatches.iter().map(|d| format!("{:?}",d.node.op)).collect::<Vec<_>>(),"alignment":256}),
    )
}
#[tauri::command]
fn speculation_plan(
    acceptance: f64,
    rtt_ms: f64,
    points: Vec<(usize, f64)>,
) -> Result<serde_json::Value, String> {
    if points.len() > 64 || points.iter().any(|(k, _)| *k > 128) {
        return Err("Too many candidates or draft depth above 128".into());
    }
    let c = speculation::choose_depth(acceptance, rtt_ms, &points)
        .ok_or("Invalid timing or acceptance inputs")?;
    Ok(
        serde_json::json!({"depth":c.depth,"expectedTokens":c.expected_tokens,"tokensPerSecond":c.expected_tokens_per_second}),
    )
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlacementDevice {
    name: String,
    capacity_mb: u32,
    layer_ms: Vec<f64>,
    overhead_ms: f64,
}
#[tauri::command]
fn placement_plan(
    layer_mb: Vec<u32>,
    devices: Vec<PlacementDevice>,
    hop_ms: Vec<Vec<f64>>,
) -> Result<serde_json::Value, String> {
    if layer_mb.is_empty()
        || layer_mb.len() > 512
        || devices.is_empty()
        || devices.len() > 16
        || layer_mb.iter().any(|v| *v == 0 || *v > 65536)
        || devices
            .iter()
            .any(|d| d.capacity_mb > 1048576 || d.layer_ms.len() > 512 || d.name.len() > 100)
        || hop_ms.len() > 16
        || hop_ms.iter().any(|r| r.len() > 16)
    {
        return Err("Invalid placement dimensions or capacity".into());
    }
    let workers: Vec<_> = devices
        .into_iter()
        .map(|d| pooled_core::placement::Device {
            name: d.name,
            weight_capacity_bytes: u64::from(d.capacity_mb) * 1024 * 1024,
            layer_ms: d.layer_ms,
            stage_overhead_ms: d.overhead_ms,
        })
        .collect();
    let layers: Vec<_> = layer_mb
        .into_iter()
        .map(|m| u64::from(m) * 1024 * 1024)
        .collect();
    let p =
        pooled_core::placement::place(&layers, &workers, &hop_ms).map_err(|e| format!("{e:?}"))?;
    Ok(
        serde_json::json!({"estimatedMs":p.estimated_ms_per_token,"stages":p.stages.iter().map(|s|serde_json::json!({"device":workers[s.device].name,"firstLayer":s.first_layer,"endLayer":s.end_layer})).collect::<Vec<_>>()}),
    )
}
#[derive(Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Model {
    path: String,
    name: String,
    bytes: u64,
    version: u32,
    tensors: u64,
}
fn registry(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let p = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p.join("models.json"))
}
#[tauri::command]
fn models(app: tauri::AppHandle) -> Result<Vec<Model>, String> {
    read_models(&registry(&app)?)
}
fn read_models(p: &std::path::Path) -> Result<Vec<Model>, String> {
    if !p.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
#[tauri::command]
fn register_model(app: tauri::AppHandle, path: String) -> Result<Model, String> {
    let m = inspect_model(&path)?;
    store_model(&registry(&app)?, m)
}
fn inspect_model(path: &str) -> Result<Model, String> {
    let p = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let mut file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header[..4] != b"GGUF" {
        return Err("Select a GGUF model file".into());
    }
    let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
    if !(2..=3).contains(&version) {
        return Err("Supported GGUF versions: 2 and 3".into());
    }
    let m = Model {
        path: p.to_string_lossy().into(),
        name: p.file_name().unwrap_or_default().to_string_lossy().into(),
        bytes: file.metadata().map_err(|e| e.to_string())?.len(),
        version,
        tensors: u64::from_le_bytes(header[8..16].try_into().unwrap()),
    };
    Ok(m)
}
fn store_model(dest: &std::path::Path, m: Model) -> Result<Model, String> {
    // Hold an OS file lock across read/modify/replace, including across app processes.
    // The companion lock file is stable while models.json is atomically replaced.
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dest.with_extension("lock"))
        .map_err(|e| format!("Cannot open model registry lock: {e}"))?;
    lock.lock()
        .map_err(|e| format!("Cannot lock model registry: {e}"))?;
    let mut list = read_models(dest)?;
    list.retain(|v| v.path != m.path);
    list.push(m.clone());
    let temporary = dest.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, dest).map_err(|e| e.to_string())?;
    Ok(m)
}
#[tauri::command]
fn preview_host(host: tauri::State<'_, preview::PreviewHost>) -> String {
    host.origin.clone()
}
fn main() {
    let host = preview::PreviewHost::start().expect("TensorMesh preview relay failed to start");
    let mut context = tauri::generate_context!();
    let csp = context
        .config_mut()
        .app
        .security
        .csp
        .take()
        .expect("TensorMesh requires a main-window CSP");
    let mut directives: std::collections::HashMap<
        String,
        tauri::utils::config::CspDirectiveSources,
    > = csp.into();
    directives
        .entry("frame-src".into())
        .or_default()
        .push(&host.origin);
    // Allow only the configured TensorMesh discovery origin, including a local service.
    // No broad http:/ws: permission and no public signaling fallback.
    let room_config: serde_json::Value =
        serde_json::from_str(include_str!("../../public/runtime/tensormesh-config.json"))
            .expect("Invalid TensorMesh room configuration");
    let mut signal = tauri::Url::parse(
        room_config["signal"]
            .as_str()
            .expect("TensorMesh signaling URL missing"),
    )
    .expect("Invalid TensorMesh signaling URL");
    let websocket_scheme = match signal.scheme() {
        "http" | "ws" => "ws",
        "https" | "wss" => "wss",
        _ => panic!("Invalid TensorMesh signaling scheme"),
    };
    signal.set_scheme(websocket_scheme).unwrap();
    directives
        .entry("connect-src".into())
        .or_default()
        .push(signal.origin().ascii_serialization());
    signal
        .set_scheme(if websocket_scheme == "ws" {
            "http"
        } else {
            "https"
        })
        .unwrap();
    directives
        .entry("connect-src".into())
        .or_default()
        .push(signal.origin().ascii_serialization());
    context.config_mut().app.security.csp = Some(directives.into());
    tauri::Builder::default()
        .manage(host)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            preview_host,
            devices,
            gpu_probe,
            graph_plan,
            speculation_plan,
            placement_plan,
            models,
            register_model
        ])
        .run(context)
        .expect("TensorMesh failed to start");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_registry_preserves_entries_and_surfaces_corruption() {
        let dir =
            std::env::temp_dir().join(format!("tensormesh-registry-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("models.json");
        let model_path = dir.join("fixture.gguf");
        let mut header = [0u8; 24];
        header[..4].copy_from_slice(b"GGUF");
        header[4..8].copy_from_slice(&3u32.to_le_bytes());
        header[8..16].copy_from_slice(&7u64.to_le_bytes());
        fs::write(&model_path, header).unwrap();
        assert!(read_models(&dest).unwrap().is_empty());
        let m = inspect_model(model_path.to_str().unwrap()).unwrap();
        assert_eq!(m.version, 3);
        assert_eq!(m.tensors, 7);
        store_model(&dest, m.clone()).unwrap();
        store_model(&dest, m).unwrap();
        assert_eq!(read_models(&dest).unwrap().len(), 1);
        fs::write(&dest, b"invalid JSON").unwrap();
        assert!(read_models(&dest).is_err());
        assert!(store_model(&dest, inspect_model(model_path.to_str().unwrap()).unwrap()).is_err());
        assert_eq!(fs::read(&dest).unwrap(), b"invalid JSON");
        fs::write(&model_path, b"truncated").unwrap();
        assert!(inspect_model(model_path.to_str().unwrap()).is_err());
        header[..4].copy_from_slice(b"NOPE");
        fs::write(&model_path, header).unwrap();
        assert!(inspect_model(model_path.to_str().unwrap()).is_err());
        header[..4].copy_from_slice(b"GGUF");
        header[4..8].copy_from_slice(&1u32.to_le_bytes());
        fs::write(&model_path, header).unwrap();
        assert!(inspect_model(model_path.to_str().unwrap()).is_err());
        fs::remove_file(model_path).unwrap();
        fs::remove_file(dest.with_extension("lock")).unwrap();
        fs::remove_file(dest).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn concurrent_registry_updates_preserve_every_entry() {
        let dir = std::env::temp_dir().join(format!(
            "tensormesh-registry-concurrent-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("models.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let tasks: Vec<_> = (0..8)
            .map(|id| {
                let dest = dest.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store_model(
                        &dest,
                        Model {
                            path: format!("fixture-{id}.gguf"),
                            name: format!("fixture-{id}"),
                            bytes: 24,
                            version: 3,
                            tensors: 7,
                        },
                    )
                })
            })
            .collect();
        let errors: Vec<_> = tasks
            .into_iter()
            .filter_map(|t| t.join().unwrap().err())
            .collect();
        let result = read_models(&dest);
        fs::remove_dir_all(&dir).unwrap();
        assert!(errors.is_empty(), "Concurrent writes failed: {errors:?}");
        assert_eq!(
            result.unwrap().len(),
            8,
            "A concurrent registry update was lost"
        );
    }
    #[test]
    fn graph_preserves_attention_barriers_and_rejects_invalid_dimensions() {
        let plan = graph_plan(5120, 128).unwrap();
        assert_eq!(plan["dispatches"], 7);
        assert!(plan["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n == "FlashDecodeReduce"));
        assert!(graph_plan(0, 128).is_err());
    }
    #[test]
    fn speculation_uses_verification_cost_not_just_acceptance() {
        let plan = speculation_plan(0.8, 10.0, vec![(8, 20.0), (16, 40.0)]).unwrap();
        assert_eq!(plan["depth"], 8);
        assert!(speculation_plan(1.1, 10.0, vec![(8, 20.0)]).is_err());
    }
    #[test]
    fn placement_obeys_host_capacity_and_accounts_for_hop_cost() {
        let workers = vec![
            PlacementDevice {
                name: "host".into(),
                capacity_mb: 256,
                layer_ms: vec![2.0; 4],
                overhead_ms: 0.0,
            },
            PlacementDevice {
                name: "peer".into(),
                capacity_mb: 512,
                layer_ms: vec![3.0; 4],
                overhead_ms: 0.0,
            },
        ];
        let p =
            placement_plan(vec![128; 4], workers, vec![vec![0.0, 5.0], vec![5.0, 0.0]]).unwrap();
        assert_eq!(p["stages"][0]["endLayer"], 2);
        assert_eq!(p["estimatedMs"], 15.0);
    }
}
