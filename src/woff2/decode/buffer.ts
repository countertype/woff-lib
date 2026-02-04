// Binary reader with bounds checking

export interface ReadBuffer {
  readonly offset: number
  readonly length: number
  readonly remaining: number
  skip(n: number): boolean
  seek(offset: number): boolean
  readU8(): number | null
  readU16(): number | null
  readS16(): number | null
  readU32(): number | null
  readBytes(n: number): Uint8Array | null
}

export class Buffer implements ReadBuffer {
  private u8: Uint8Array
  private pos: number = 0

  constructor(data: ArrayBuffer | Uint8Array, offset: number = 0, length?: number) {
    if (data instanceof Uint8Array) {
      const len = length ?? data.byteLength - offset
      this.u8 = data.subarray(offset, offset + len)
    } else {
      const len = length ?? data.byteLength - offset
      this.u8 = new Uint8Array(data, offset, len)
    }
  }

  get offset(): number {
    return this.pos
  }

  get length(): number {
    return this.u8.byteLength
  }

  get remaining(): number {
    return this.u8.byteLength - this.pos
  }

  skip(n: number): boolean {
    if (this.pos + n > this.u8.byteLength || this.pos + n < this.pos) {
      return false
    }
    this.pos += n
    return true
  }

  seek(offset: number): boolean {
    if (offset > this.u8.byteLength || offset < 0) {
      return false
    }
    this.pos = offset
    return true
  }

  readU8(): number | null {
    if (this.pos + 1 > this.u8.byteLength) return null
    return this.u8[this.pos++]
  }

  readU16(): number | null {
    if (this.pos + 2 > this.u8.byteLength) return null
    const idx = this.pos
    this.pos = idx + 2
    return (this.u8[idx] << 8) | this.u8[idx + 1]
  }

  readS16(): number | null {
    if (this.pos + 2 > this.u8.byteLength) return null
    const idx = this.pos
    this.pos = idx + 2
    const val = (this.u8[idx] << 8) | this.u8[idx + 1]
    return (val & 0x8000) !== 0 ? val - 0x10000 : val
  }

  readU32(): number | null {
    if (this.pos + 4 > this.u8.byteLength) return null
    const idx = this.pos
    this.pos = idx + 4
    return (
      (this.u8[idx] * 0x1000000 +
        ((this.u8[idx + 1] << 16) | (this.u8[idx + 2] << 8) | this.u8[idx + 3])) >>>
      0
    )
  }

  readBytes(n: number): Uint8Array | null {
    if (this.pos + n > this.u8.byteLength || n < 0) return null
    const result = this.u8.subarray(this.pos, this.pos + n)
    this.pos += n
    return result
  }

  subarray(offset: number, length: number): Uint8Array | null {
    if (offset + length > this.u8.byteLength || offset < 0 || length < 0) {
      return null
    }
    return this.u8.subarray(offset, offset + length)
  }
}
