// WOFF2 hmtx reconstruction (section 5.4)
// Restores LSBs that were dropped because they equal the glyph xMin

export function reconstructHmtx(
  data: Uint8Array,
  srcOffset: number,
  srcLength: number,
  numGlyphs: number,
  numHMetrics: number,
  xMins: Int16Array
): Uint8Array {
  if (srcLength < 1) throw new Error('Stream overflow')
  if (numHMetrics > numGlyphs) throw new Error('Invalid hmtx: numHMetrics exceeds numGlyphs')

  const flags = data[srcOffset]
  const hasProportionalLsbs = (flags & 1) === 0
  const hasMonospaceLsbs = (flags & 2) === 0
  const numMonospace = numGlyphs - numHMetrics

  let advancePos = srcOffset + 1
  let lsbPos = advancePos + numHMetrics * 2
  const needed =
    1 +
    numHMetrics * 2 +
    (hasProportionalLsbs ? numHMetrics * 2 : 0) +
    (hasMonospaceLsbs ? numMonospace * 2 : 0)
  if (needed > srcLength) throw new Error('Stream overflow')

  const output = new Uint8Array(numHMetrics * 4 + numMonospace * 2)
  let o = 0

  for (let i = 0; i < numHMetrics; i++) {
    output[o] = data[advancePos]
    output[o + 1] = data[advancePos + 1]
    advancePos += 2
    if (hasProportionalLsbs) {
      output[o + 2] = data[lsbPos]
      output[o + 3] = data[lsbPos + 1]
      lsbPos += 2
    } else {
      const lsb = xMins[i]
      output[o + 2] = lsb >> 8
      output[o + 3] = lsb
    }
    o += 4
  }

  for (let i = numHMetrics; i < numGlyphs; i++) {
    if (hasMonospaceLsbs) {
      output[o] = data[lsbPos]
      output[o + 1] = data[lsbPos + 1]
      lsbPos += 2
    } else {
      const lsb = xMins[i]
      output[o] = lsb >> 8
      output[o + 1] = lsb
    }
    o += 2
  }

  return output
}
