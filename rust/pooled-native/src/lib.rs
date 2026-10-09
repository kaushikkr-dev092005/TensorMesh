//! Native parity probe for the browser's unchanged Q4_0 WGSL matvec.

use pooled_core::{
    compiler::{compile, FusionCapabilities},
    graph::{Graph, Node, Op, Tensor},
    memory::Limits,
    q4,
};
use std::num::NonZeroU64;
use std::{borrow::Cow, error::Error, sync::mpsc, time::Instant};
use wgpu::util::DeviceExt;

const BROWSER_SHADER_JS: &str = include_str!("../../../engine/wgsl/base.js");
const ROWS: u32 = 73; // non-workgroup multiple checks the tail guard
const COLS: u32 = 256;
const BLOCK: usize = 32;

fn browser_wgsl() -> Result<&'static str, Box<dyn Error>> {
    let start = BROWSER_SHADER_JS
        .find("export const WGSL = /* wgsl */ `")
        .ok_or("WGSL template start missing")?
        + "export const WGSL = /* wgsl */ `".len();
    let end = BROWSER_SHADER_JS
        .rfind("`;")
        .ok_or("WGSL template end missing")?;
    let wgsl = &BROWSER_SHADER_JS[start..end];
    if wgsl.contains("${") {
        return Err("base WGSL contains JavaScript interpolation".into());
    }
    Ok(wgsl)
}

struct Fixture {
    packed: Vec<u32>,
    scales: Vec<u32>,
    input: Vec<f32>,
    expected: Vec<f32>,
}

fn fixture(rows: u32, cols: u32) -> Fixture {
    assert_eq!(cols as usize % BLOCK, 0);
    let blocks = rows as usize * cols as usize / BLOCK;
    let mut packed = Vec::with_capacity(blocks * 4);
    let mut scales = vec![0u32; blocks.div_ceil(2)];
    let input: Vec<f32> = (0..cols)
        .map(|i| (((i * 13 + 7) % 31) as f32 - 15.0) / 16.0)
        .collect();
    for block in 0..blocks {
        let scale_bits = [0x3800u32, 0x3c00, 0x4000][block % 3]; // 0.5, 1, 2
        scales[block / 2] |= scale_bits << (16 * (block & 1));
        for word in 0..4 {
            let mut bits = 0u32;
            for byte in 0..4 {
                let j = word * 4 + byte;
                let lo = ((block * 11 + j * 7 + 3) % 16) as u32;
                let hi = ((block * 5 + j * 13 + 9) % 16) as u32;
                bits |= (lo | (hi << 4)) << (byte * 8);
            }
            packed.push(bits);
        }
    }
    let expected = q4::matvec(&packed, &scales, &input, rows as usize, cols as usize).unwrap();
    Fixture {
        packed,
        scales,
        input,
        expected,
    }
}

fn u32_bytes(values: &[u32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn f32_bytes(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub fn run_probe(iterations: u32) -> Result<ProbeResult, Box<dyn Error>> {
    if iterations == 0 {
        return Err("iterations must be positive".into());
    }
    let data = fixture(ROWS, COLS);
    let instance = wgpu::Instance::default();
    let adapter = futures_executor::block_on(
        instance.request_adapter(&wgpu::RequestAdapterOptions::default()),
    )
    .ok_or("no native GPU adapter found")?;
    let adapter_info = adapter.get_info();
    let (device, queue) = futures_executor::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("Pooled native Q4 parity"),
            required_limits: adapter.limits(),
            ..Default::default()
        },
        None,
    ))?;
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Pooled browser base WGSL"),
        source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(browser_wgsl()?)),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("matvec_q4"),
        layout: None,
        module: &shader,
        entry_point: "matvec_q4",
        compilation_options: Default::default(),
    });
    let make_input = |label, bytes: Vec<u8>| {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: &bytes,
            usage: wgpu::BufferUsages::STORAGE,
        })
    };
    let weights = make_input("Q4 packed nibbles", u32_bytes(&data.packed));
    let scales = make_input("Q4 f16 scales", u32_bytes(&data.scales));
    let input = make_input("activation", f32_bytes(&data.input));
    let shape = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("shape"),
        contents: &u32_bytes(&[ROWS, COLS]),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let output_size = ROWS as u64 * 4;
    let graph = Graph {
        tensors: vec![
            Tensor {
                name: "weights".into(),
                bytes: (data.packed.len() * 4) as u64,
                persistent: true,
            },
            Tensor {
                name: "scales".into(),
                bytes: (data.scales.len() * 4) as u64,
                persistent: true,
            },
            Tensor {
                name: "input".into(),
                bytes: COLS as u64 * 4,
                persistent: true,
            },
            Tensor {
                name: "output".into(),
                bytes: output_size,
                persistent: false,
            },
        ],
        nodes: vec![Node {
            op: Op::QuantizedMatvec,
            inputs: vec![0, 1, 2],
            outputs: vec![3],
        }],
    };
    let limits = device.limits();
    let plan = compile(
        &graph,
        Limits {
            max_buffer_size: limits.max_buffer_size,
            max_storage_binding_size: limits.max_storage_buffer_binding_size as u64,
        },
        &[3],
        FusionCapabilities::default(),
    )
    .map_err(|e| format!("graph compilation failed: {e:?}"))?;
    let arenas: Vec<_> = plan
        .memory
        .arenas
        .iter()
        .map(|&size| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("planned activation arena"),
                size,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            })
        })
        .collect();
    let allocation = plan.memory.allocations[3].ok_or("output allocation missing")?;
    let output = &arenas[allocation.arena];
    let indirect_table = plan
        .indirect_table(
            &[[ROWS.div_ceil(64), 1, 1]],
            limits.max_compute_workgroups_per_dimension,
        )
        .map_err(|e| format!("indirect geometry failed: {e:?}"))?;
    let indirect = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("planned indirect dispatch"),
        contents: &indirect_table.bytes,
        usage: wgpu::BufferUsages::INDIRECT | wgpu::BufferUsages::COPY_DST,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: output_size,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    // Auto layout retains group 0 even though matvec resources start at group 1.
    // wgpu requires that empty layout to be bound before dispatch.
    let empty_layout = pipeline.get_bind_group_layout(0);
    let empty_bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("empty group 0"),
        layout: &empty_layout,
        entries: &[],
    });
    let layout = pipeline.get_bind_group_layout(1);
    let bindings = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Q4 bindings"),
        layout: &layout,
        entries: [
            wgpu::BindGroupEntry {
                binding: 0,
                resource: weights.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: scales.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: input.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: output,
                    offset: allocation.offset,
                    size: NonZeroU64::new(allocation.bytes),
                }),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: shape.as_entire_binding(),
            },
        ]
        .as_slice(),
    });

    let start = Instant::now();
    for _ in 0..iterations {
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Q4 dispatch"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Q4 matvec"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &empty_bindings, &[]);
            pass.set_bind_group(1, &bindings, &[]);
            pass.dispatch_workgroups_indirect(&indirect, indirect_table.offsets[0]);
        }
        queue.submit([encoder.finish()]);
    }
    device.poll(wgpu::Maintain::Wait);
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let mut copy = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("readback"),
    });
    copy.copy_buffer_to_buffer(output, allocation.offset, &readback, 0, output_size);
    queue.submit([copy.finish()]);
    let (tx, rx) = mpsc::channel();
    readback
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
    device.poll(wgpu::Maintain::Wait);
    rx.recv()??;
    let mapped = readback.slice(..).get_mapped_range();
    let actual: Vec<f32> = mapped
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect();
    let max_error = actual
        .iter()
        .zip(&data.expected)
        .map(|(a, e)| (a - e).abs())
        .fold(0.0f32, f32::max);
    for (row, (a, e)) in actual.iter().zip(&data.expected).enumerate() {
        let tolerance = 0.001 + 0.0001 * e.abs();
        if !a.is_finite() || (a - e).abs() > tolerance {
            return Err(format!(
                "Q4 parity failed at row {row}: GPU={a}, CPU={e}, tolerance={tolerance}"
            )
            .into());
        }
    }
    drop(mapped);
    readback.unmap();
    Ok(ProbeResult {
        adapter: adapter_info.name,
        backend: format!("{:?}", adapter_info.backend),
        rows: ROWS,
        cols: COLS,
        iterations,
        average_wall_ms: elapsed_ms / iterations as f64,
        max_abs_error: max_error,
    })
}

#[derive(Debug)]
pub struct ProbeResult {
    pub adapter: String,
    pub backend: String,
    pub rows: u32,
    pub cols: u32,
    pub iterations: u32,
    pub average_wall_ms: f64,
    pub max_abs_error: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shader_source_is_browser_kernel() {
        let wgsl = browser_wgsl().unwrap();
        assert!(wgsl.contains("fn matvec_q4("));
        assert!(wgsl.contains("fn matvec_q8("));
    }

    #[test]
    fn fixture_has_finite_reference_and_packed_blocks() {
        let f = fixture(ROWS, COLS);
        assert_eq!(f.packed.len(), (ROWS * COLS / 8) as usize);
        assert!(f.expected.iter().all(|v| v.is_finite()));
    }
}
