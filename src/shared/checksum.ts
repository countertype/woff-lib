// SFNT table checksum computation

export function computeChecksum(data: Uint8Array, offset: number, length: number): number {
  let sum = 0
  const end = offset + length
  const view = new DataView(data.buffer, data.byteOffset)

  // Process 4-byte aligned words
  const alignedEnd = offset + (length & ~3)
  for (let i = offset; i < alignedEnd; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0
  }

  // Handle remaining 1-3 bytes
  if (end > alignedEnd) {
    let last = 0
    for (let i = alignedEnd; i < end; i++) {
      last = (last << 8) | data[i]
    }
    last <<= (4 - (end - alignedEnd)) * 8
    sum = (sum + last) >>> 0
  }

  return sum
}

// Pad to 4-byte boundary
export function pad4(n: number): number {
  return (n + 3) & ~3
}
