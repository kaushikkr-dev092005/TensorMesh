//! Scalar Q4_0 oracle matching Pooled's split nibble and f16-scale buffers.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Q4Error {
    InvalidShape,
    InvalidBufferLength,
}

pub fn f16_to_f32(bits: u16) -> f32 {
    let sign = ((bits as u32) & 0x8000) << 16;
    let exp = ((bits >> 10) & 0x1f) as i32;
    let fraction = (bits & 0x03ff) as u32;
    let out = match exp {
        0 if fraction == 0 => sign,
        0 => {
            let mut fraction = fraction;
            let mut exponent = -14;
            while fraction & 0x400 == 0 {
                fraction <<= 1;
                exponent -= 1;
            }
            sign | (((exponent + 127) as u32) << 23) | ((fraction & 0x3ff) << 13)
        }
        31 => sign | 0x7f80_0000 | (fraction << 13),
        _ => sign | (((exp - 15 + 127) as u32) << 23) | (fraction << 13),
    };
    f32::from_bits(out)
}

/// `packed` contains four u32 words per 32-weight block. Each byte holds
/// element j in its low nibble and element j+16 in its high nibble.
/// `scales` contains two f16 block scales per u32 word.
pub fn matvec(
    packed: &[u32],
    scales: &[u32],
    input: &[f32],
    rows: usize,
    cols: usize,
) -> Result<Vec<f32>, Q4Error> {
    if rows == 0 || cols == 0 || cols % 32 != 0 || input.len() != cols {
        return Err(Q4Error::InvalidShape);
    }
    let blocks = rows.checked_mul(cols / 32).ok_or(Q4Error::InvalidShape)?;
    if packed.len() != blocks.checked_mul(4).ok_or(Q4Error::InvalidShape)?
        || scales.len() != blocks.div_ceil(2)
    {
        return Err(Q4Error::InvalidBufferLength);
    }
    let mut output = vec![0.0; rows];
    let blocks_per_row = cols / 32;
    for (row, out) in output.iter_mut().enumerate() {
        for b in 0..blocks_per_row {
            let block = row * blocks_per_row + b;
            let scale_bits = ((scales[block / 2] >> ((block & 1) * 16)) & 0xffff) as u16;
            let scale = f16_to_f32(scale_bits);
            let mut sum = 0.0f32;
            let xbase = b * 32;
            for word in 0..4 {
                let bits = packed[block * 4 + word];
                for byte in 0..4 {
                    let j = word * 4 + byte;
                    let quantized = (bits >> (byte * 8)) & 0xff;
                    sum += ((quantized & 0xf) as f32 - 8.0) * input[xbase + j];
                    sum += ((quantized >> 4) as f32 - 8.0) * input[xbase + j + 16];
                }
            }
            *out += scale * sum;
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_scales_cover_normal_and_subnormal() {
        assert_eq!(f16_to_f32(0x3800), 0.5);
        assert_eq!(f16_to_f32(0x3c00), 1.0);
        assert_eq!(f16_to_f32(0xc000), -2.0);
        assert_eq!(f16_to_f32(0x0001), 2.0f32.powi(-24));
    }

    #[test]
    fn nibble_layout_and_scale_are_independent() {
        // All 32 weights are -8 except element 0 = +7 and element 16 = 0.
        let mut packed = vec![0u32; 4];
        packed[0] = 0x8f;
        let mut input = vec![0.0; 32];
        input[0] = 2.0;
        input[16] = 3.0;
        let actual = matvec(&packed, &[0x3800], &input, 1, 32).unwrap();
        assert_eq!(actual, vec![7.0]);
    }

    #[test]
    fn rejects_mismatched_buffer_lengths() {
        assert_eq!(
            matvec(&[], &[0x3c00], &[1.0; 32], 1, 32),
            Err(Q4Error::InvalidBufferLength)
        );
    }
}
