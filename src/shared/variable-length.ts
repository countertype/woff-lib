// WOFF2 variable-length integer encoding (section 4.1)

import type { ReadBuffer } from '../woff2/decode/buffer'

// 255UShort: values 0-65535
export function read255UShort(buf: ReadBuffer): number | null {
  const code = buf.readU8()
  if (code === null) return null

  if (code === 253) {
    return buf.readU16()
  } else if (code === 255) {
    const next = buf.readU8()
    if (next === null) return null
    return 253 + next
  } else if (code === 254) {
    const next = buf.readU8()
    if (next === null) return null
    return 506 + next
  }
  return code
}

// UIntBase128: table lengths, offsets
export function readBase128(buf: ReadBuffer): number | null {
  let result = 0

  for (let i = 0; i < 5; i++) {
    const code = buf.readU8()
    if (code === null) return null

    // Leading zeros are invalid
    if (i === 0 && code === 0x80) return null

    // Check for overflow
    if ((result & 0xfe000000) !== 0) return null

    result = (result << 7) | (code & 0x7f)

    // High bit clear = done
    if ((code & 0x80) === 0) return result
  }

  return null
}

// Size calculation for encoder
export function sizeBase128(value: number): number {
  if (value < 0x80) return 1
  if (value < 0x4000) return 2
  if (value < 0x200000) return 3
  if (value < 0x10000000) return 4
  return 5
}
