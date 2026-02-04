// Write buffer with auto-growing capacity

export class WriteBuffer {
  private data: Uint8Array
  private view: DataView
  private pos: number = 0

  constructor(initialSize: number = 65536) {
    this.data = new Uint8Array(initialSize)
    this.view = new DataView(this.data.buffer)
  }

  private ensureCapacity(needed: number): void {
    if (this.pos + needed <= this.data.byteLength) return

    // Grow by 2x (amortized O(1) appends)
    const newSize = Math.max(this.data.byteLength * 2, this.pos + needed)
    const newData = new Uint8Array(newSize)
    newData.set(this.data)
    this.data = newData
    this.view = new DataView(newData.buffer)
  }

  writeU8(value: number): void {
    this.ensureCapacity(1)
    this.data[this.pos++] = value
  }

  // Unchecked write for hot paths where capacity is pre-ensured
  writeU8Fast(value: number): void {
    this.data[this.pos++] = value
  }

  writeU16(value: number): void {
    this.ensureCapacity(2)
    this.view.setUint16(this.pos, value)
    this.pos += 2
  }

  writeS16(value: number): void {
    this.ensureCapacity(2)
    this.view.setInt16(this.pos, value)
    this.pos += 2
  }

  writeU32(value: number): void {
    this.ensureCapacity(4)
    this.view.setUint32(this.pos, value)
    this.pos += 4
  }

  writeBytes(src: Uint8Array): void {
    this.ensureCapacity(src.byteLength)
    this.data.set(src, this.pos)
    this.pos += src.byteLength
  }

  // UIntBase128: variable-length encoding for table sizes
  writeBase128(value: number): void {
    if (value < 0x80) {
      this.writeU8(value)
    } else if (value < 0x4000) {
      this.writeU8(0x80 | (value >> 7))
      this.writeU8(value & 0x7f)
    } else if (value < 0x200000) {
      this.writeU8(0x80 | (value >> 14))
      this.writeU8(0x80 | ((value >> 7) & 0x7f))
      this.writeU8(value & 0x7f)
    } else if (value < 0x10000000) {
      this.writeU8(0x80 | (value >> 21))
      this.writeU8(0x80 | ((value >> 14) & 0x7f))
      this.writeU8(0x80 | ((value >> 7) & 0x7f))
      this.writeU8(value & 0x7f)
    } else {
      this.writeU8(0x80 | (value >> 28))
      this.writeU8(0x80 | ((value >> 21) & 0x7f))
      this.writeU8(0x80 | ((value >> 14) & 0x7f))
      this.writeU8(0x80 | ((value >> 7) & 0x7f))
      this.writeU8(value & 0x7f)
    }
  }

  // 255UShort: compact encoding for small values
  write255UShort(value: number): void {
    if (value < 253) {
      this.writeU8(value)
    } else if (value < 506) {
      this.writeU8(255)
      this.writeU8(value - 253)
    } else if (value < 762) {
      this.writeU8(254)
      this.writeU8(value - 506)
    } else {
      this.writeU8(253)
      this.writeU16(value)
    }
  }

  getBytes(): Uint8Array {
    return this.data.subarray(0, this.pos)
  }

  get offset(): number {
    return this.pos
  }

  // Allow direct write at specific position (for backpatching)
  setU32(offset: number, value: number): void {
    this.view.setUint32(offset, value)
  }

  setU16(offset: number, value: number): void {
    this.view.setUint16(offset, value)
  }
}
