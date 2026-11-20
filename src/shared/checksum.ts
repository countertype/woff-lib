// SFNT table checksum computation

export function computeChecksum(data: Uint8Array, offset: number, length: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const end = offset + length
  const alignedEnd = offset + (length & ~3)
  let i = offset

  // Four independent sums so the adds do not form one dependency chain
  const end16 = offset + (length & ~15)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  for (; i < end16; i += 16) {
    s0 = (s0 + view.getInt32(i)) | 0
    s1 = (s1 + view.getInt32(i + 4)) | 0
    s2 = (s2 + view.getInt32(i + 8)) | 0
    s3 = (s3 + view.getInt32(i + 12)) | 0
  }
  let sum = (((s0 + s1) | 0) + ((s2 + s3) | 0)) | 0

  for (; i < alignedEnd; i += 4) {
    sum = (sum + view.getInt32(i)) | 0
  }

  // Remaining 1-3 bytes, zero padded to a full word
  if (end > alignedEnd) {
    let last = 0
    for (let j = alignedEnd; j < end; j++) {
      last = (last << 8) | data[j]
    }
    last <<= (4 - (end - alignedEnd)) * 8
    sum = (sum + last) | 0
  }

  return sum >>> 0
}

// Pad to 4-byte boundary
export function pad4(n: number): number {
  return (n + 3) & ~3
}
