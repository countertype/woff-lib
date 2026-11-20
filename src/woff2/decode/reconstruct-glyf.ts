// WOFF2 glyf/loca reconstruction (section 5.1-5.2)
// Rebuilds TrueType glyf and loca from the transformed substreams

const FLAG_REPEAT = 1 << 3
const FLAG_OVERLAP_SIMPLE = 1 << 6

// Triplet decode tables, indexed by the low 7 bits of the flag byte (spec table 2)
// META packs nBytes | xShift << 3 | yShift << 8 | xNegative << 24 | yNegative << 25
const TRIPLET_META = new Int32Array(128)
const TRIPLET_X_BASE = new Uint16Array(128)
const TRIPLET_Y_BASE = new Uint16Array(128)
const TRIPLET_X_MASK = new Uint16Array(128)
const TRIPLET_Y_MASK = new Uint16Array(128)

for (let f = 0; f < 128; f++) {
  let nBytes: number
  let xShift = 0
  let yShift = 0
  let xBase = 0
  let yBase = 0
  let xMask = 0
  let yMask = 0
  let xNeg = (f & 1) === 0 ? 1 : 0
  let yNeg = (f & 2) === 0 ? 1 : 0

  if (f < 10) {
    // dx = 0, sign bit applies to dy
    nBytes = 1
    yShift = 24
    yMask = 0xff
    yBase = (f & 14) << 7
    yNeg = xNeg
    xNeg = 0
  } else if (f < 20) {
    // dy = 0
    nBytes = 1
    xShift = 24
    xMask = 0xff
    xBase = ((f - 10) & 14) << 7
    yNeg = 0
  } else if (f < 84) {
    const b0 = f - 20
    nBytes = 1
    xShift = 28
    xMask = 0x0f
    xBase = 1 + (b0 & 0x30)
    yShift = 24
    yMask = 0x0f
    yBase = 1 + ((b0 & 0x0c) << 2)
  } else if (f < 120) {
    const idx = f - 84
    nBytes = 2
    xShift = 24
    xMask = 0xff
    xBase = 1 + (((idx / 12) | 0) << 8)
    yShift = 16
    yMask = 0xff
    yBase = 1 + (((idx % 12) >> 2) << 8)
  } else if (f < 124) {
    nBytes = 3
    xShift = 20
    xMask = 0xfff
    yShift = 8
    yMask = 0xfff
  } else {
    nBytes = 4
    xShift = 16
    xMask = 0xffff
    yMask = 0xffff
  }

  TRIPLET_META[f] = nBytes | (xShift << 3) | (yShift << 8) | (xNeg << 24) | (yNeg << 25)
  TRIPLET_X_BASE[f] = xBase
  TRIPLET_Y_BASE[f] = yBase
  TRIPLET_X_MASK[f] = xMask
  TRIPLET_Y_MASK[f] = yMask
}

// Below this size a loop beats set(subarray()), which allocates a view
const SMALL_COPY = 48

function copyBytes(
  dst: Uint8Array,
  dstPos: number,
  src: Uint8Array,
  srcPos: number,
  n: number
): void {
  if (n < SMALL_COPY) {
    for (let i = 0; i < n; i++) dst[dstPos + i] = src[srcPos + i]
  } else {
    dst.set(src.subarray(srcPos, srcPos + n), dstPos)
  }
}

function readU32(data: Uint8Array, p: number): number {
  return data[p] * 0x1000000 + ((data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3])
}

function grow(out: Uint8Array, needed: number): Uint8Array {
  const next = new Uint8Array(Math.max(needed, out.byteLength * 2))
  next.set(out)
  return next
}

export interface ReconstructedGlyf {
  // Differs from the buffer passed in when it had to grow
  out: Uint8Array
  glyfLength: number
  locaData: Uint8Array
  numGlyphs: number
  indexFormat: number
  xMins: Int16Array
}

// Writes glyf into `out` at `outStart`. The declared origLength is only a
// hint: glyphs are re-packed and padded to 4 bytes, so the size can differ
export function reconstructGlyf(
  data: Uint8Array,
  srcOffset: number,
  srcLength: number,
  out: Uint8Array,
  outStart: number
): ReconstructedGlyf {
  if (srcLength < 36) throw new Error('Stream overflow')

  const optionFlags = (data[srcOffset + 2] << 8) | data[srcOffset + 3]
  const numGlyphs = (data[srcOffset + 4] << 8) | data[srcOffset + 5]
  const indexFormat = (data[srcOffset + 6] << 8) | data[srcOffset + 7]

  // Substreams are contiguous, each cursor starts where the previous ends
  let nContourPos = srcOffset + 36
  const nContourEnd = nContourPos + readU32(data, srcOffset + 8)
  let nPointsPos = nContourEnd
  const nPointsEnd = nPointsPos + readU32(data, srcOffset + 12)
  let flagPos = nPointsEnd
  const flagEnd = flagPos + readU32(data, srcOffset + 16)
  let glyphPos = flagEnd
  const glyphEnd = glyphPos + readU32(data, srcOffset + 20)
  let compositePos = glyphEnd
  const compositeEnd = compositePos + readU32(data, srcOffset + 24)
  const bboxStart = compositeEnd
  const bboxEnd = bboxStart + readU32(data, srcOffset + 28)
  let instructionPos = bboxEnd
  const instructionEnd = instructionPos + readU32(data, srcOffset + 32)

  const hasOverlapBitmap = (optionFlags & 1) !== 0
  const overlapStart = instructionEnd
  const overlapLength = hasOverlapBitmap ? (numGlyphs + 7) >> 3 : 0

  if (instructionEnd + overlapLength > srcOffset + srcLength) {
    throw new Error('Stream overflow')
  }
  if (nContourPos + numGlyphs * 2 > nContourEnd) throw new Error('Stream overflow')

  let bboxPos = bboxStart + (((numGlyphs + 31) >> 5) << 2)
  if (bboxPos > bboxEnd) throw new Error('Stream overflow')

  const locaValues = new Uint32Array(numGlyphs + 1)
  const xMins = new Int16Array(numGlyphs)

  let flagsScratch = new Uint8Array(1024)
  let xScratch = new Uint8Array(1024)
  let yScratch = new Uint8Array(1024)

  let o = outStart

  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    locaValues[glyphId] = o - outStart

    const nContours = (((data[nContourPos] << 8) | data[nContourPos + 1]) << 16) >> 16
    nContourPos += 2

    const bit = 0x80 >> (glyphId & 7)
    const haveBbox = (data[bboxStart + (glyphId >> 3)] & bit) !== 0

    if (nContours === 0) {
      if (haveBbox) throw new Error(`Empty glyph ${glyphId} has bbox`)
      continue
    }

    if (nContours === -1) {
      if (!haveBbox) throw new Error(`Composite glyph ${glyphId} missing bbox`)

      const compositeStart = compositePos
      let haveInstructions = false
      let flags = 0x20
      while (flags & 0x20) {
        if (compositePos + 2 > compositeEnd) throw new Error('Stream overflow')
        flags = (data[compositePos] << 8) | data[compositePos + 1]
        if (flags & 0x100) haveInstructions = true
        // flags + glyph index + args (words or bytes) + optional transform
        let size = flags & 0x01 ? 8 : 6
        if (flags & 0x08) size += 2
        else if (flags & 0x40) size += 4
        else if (flags & 0x80) size += 8
        compositePos += size
      }
      if (compositePos > compositeEnd) throw new Error('Stream overflow')
      const compositeLength = compositePos - compositeStart

      let instructionSize = 0
      if (haveInstructions) {
        instructionSize = data[glyphPos++]
        if (instructionSize >= 253) {
          if (instructionSize === 253) {
            instructionSize = (data[glyphPos] << 8) | data[glyphPos + 1]
            glyphPos += 2
          } else if (instructionSize === 255) {
            instructionSize = 253 + data[glyphPos++]
          } else {
            instructionSize = 506 + data[glyphPos++]
          }
        }
        if (glyphPos > glyphEnd) throw new Error('Stream overflow')
        if (instructionPos + instructionSize > instructionEnd) throw new Error('Stream overflow')
      }
      if (bboxPos + 8 > bboxEnd) throw new Error('Stream overflow')

      const glyphSize = 10 + compositeLength + (haveInstructions ? 2 + instructionSize : 0)
      if (o + glyphSize + 3 > out.byteLength) out = grow(out, o + glyphSize + 3)

      out[o] = 0xff
      out[o + 1] = 0xff
      for (let i = 0; i < 8; i++) out[o + 2 + i] = data[bboxPos + i]
      xMins[glyphId] = (((data[bboxPos] << 8) | data[bboxPos + 1]) << 16) >> 16
      bboxPos += 8

      copyBytes(out, o + 10, data, compositeStart, compositeLength)

      if (haveInstructions) {
        const w = o + 10 + compositeLength
        out[w] = instructionSize >> 8
        out[w + 1] = instructionSize
        copyBytes(out, w + 2, data, instructionPos, instructionSize)
        instructionPos += instructionSize
      }

      o = (o + glyphSize + 3) & ~3
      continue
    }

    if (nContours < 0) throw new Error(`Invalid nContours for glyph ${glyphId}`)

    // Simple glyph: endPtsOfContours go straight to the output
    if (o + 12 + 2 * nContours > out.byteLength) out = grow(out, o + 12 + 2 * nContours)
    let w = o + 10
    let totalPoints = 0
    for (let i = 0; i < nContours; i++) {
      let n = data[nPointsPos++]
      if (n >= 253) {
        if (n === 253) {
          n = (data[nPointsPos] << 8) | data[nPointsPos + 1]
          nPointsPos += 2
        } else if (n === 255) {
          n = 253 + data[nPointsPos++]
        } else {
          n = 506 + data[nPointsPos++]
        }
      }
      totalPoints += n
      const endPoint = totalPoints - 1
      out[w] = endPoint >> 8
      out[w + 1] = endPoint
      w += 2
    }
    if (nPointsPos > nPointsEnd) throw new Error('Stream overflow')
    if (flagPos + totalPoints > flagEnd) throw new Error('Stream overflow')

    // Worst case per point: 2 bytes, plus slack for the unconditional second store
    const scratchSize = totalPoints * 2 + 2
    if (scratchSize > flagsScratch.length) {
      flagsScratch = new Uint8Array(scratchSize * 2)
      xScratch = new Uint8Array(scratchSize * 2)
      yScratch = new Uint8Array(scratchSize * 2)
    }

    let flagsLen = 0
    let xLen = 0
    let yLen = 0
    let x = 0
    let y = 0
    let xMin = 0
    let yMin = 0
    let xMax = 0
    let yMax = 0
    if (totalPoints > 0) {
      xMin = yMin = 0x7fffffff
      xMax = yMax = -0x80000000
    }
    let lastFlag = -1
    let repeatCount = 0
    // Overlap bit belongs on the first point only
    let overlap =
      hasOverlapBitmap && (data[overlapStart + (glyphId >> 3)] & bit) !== 0
        ? FLAG_OVERLAP_SIMPLE
        : 0

    // Table-driven and branch-free, since the triplet format varies point to
    // point. Reads past glyphEnd are caught after the loop
    const flagStop = flagPos + totalPoints
    while (flagPos < flagStop) {
      const flag = data[flagPos++]
      const f = flag & 0x7f
      const meta = TRIPLET_META[f]
      const v =
        (data[glyphPos] << 24) |
        (data[glyphPos + 1] << 16) |
        (data[glyphPos + 2] << 8) |
        data[glyphPos + 3]
      glyphPos += meta & 7

      const absX = TRIPLET_X_BASE[f] + ((v >>> ((meta >> 3) & 31)) & TRIPLET_X_MASK[f])
      const absY = TRIPLET_Y_BASE[f] + ((v >>> ((meta >> 8) & 31)) & TRIPLET_Y_MASK[f])
      const xSign = (meta << 7) >> 31
      const ySign = (meta << 6) >> 31
      const dx = (absX ^ xSign) - xSign
      const dy = (absY ^ ySign) - ySign

      x += dx
      y += dy
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y

      // TrueType packing: 0 bytes if zero, 1 if |d| <= 255, else 2
      const xNonZero = -absX >>> 31
      const xLong = (255 - absX) >>> 31
      const xLongMask = -xLong
      xScratch[xLen] = (absX & ~xLongMask) | ((dx >> 8) & xLongMask)
      xScratch[xLen + 1] = dx
      xLen += xNonZero + xLong
      const xShort = xNonZero ^ xLong
      const xSame = (xNonZero ^ 1) | (xShort & (-dx >>> 31))

      const yNonZero = -absY >>> 31
      const yLong = (255 - absY) >>> 31
      const yLongMask = -yLong
      yScratch[yLen] = (absY & ~yLongMask) | ((dy >> 8) & yLongMask)
      yScratch[yLen + 1] = dy
      yLen += yNonZero + yLong
      const yShort = yNonZero ^ yLong
      const ySame = (yNonZero ^ 1) | (yShort & (-dy >>> 31))

      // ON_CURVE | X_SHORT | Y_SHORT | X_SAME | Y_SAME
      const outFlag =
        ((flag >> 7) ^ 1) | (xShort << 1) | (yShort << 2) | (xSame << 4) | (ySame << 5) | overlap
      overlap = 0

      if (outFlag === lastFlag && repeatCount < 255) {
        flagsScratch[flagsLen - 1] |= FLAG_REPEAT
        repeatCount++
      } else {
        if (repeatCount > 0) {
          flagsScratch[flagsLen++] = repeatCount
          repeatCount = 0
        }
        flagsScratch[flagsLen++] = outFlag
        lastFlag = outFlag
      }
    }
    if (repeatCount > 0) flagsScratch[flagsLen++] = repeatCount

    // Instruction length follows the triplets in the glyph stream
    let instructionSize = data[glyphPos++]
    if (instructionSize >= 253) {
      if (instructionSize === 253) {
        instructionSize = (data[glyphPos] << 8) | data[glyphPos + 1]
        glyphPos += 2
      } else if (instructionSize === 255) {
        instructionSize = 253 + data[glyphPos++]
      } else {
        instructionSize = 506 + data[glyphPos++]
      }
    }
    if (glyphPos > glyphEnd) throw new Error('Stream overflow')
    if (instructionPos + instructionSize > instructionEnd) throw new Error('Stream overflow')

    const glyphSize = 12 + 2 * nContours + instructionSize + flagsLen + xLen + yLen
    if (o + glyphSize + 3 > out.byteLength) out = grow(out, o + glyphSize + 3)

    out[o] = nContours >> 8
    out[o + 1] = nContours

    if (haveBbox) {
      if (bboxPos + 8 > bboxEnd) throw new Error('Stream overflow')
      for (let i = 0; i < 8; i++) out[o + 2 + i] = data[bboxPos + i]
      xMin = (((data[bboxPos] << 8) | data[bboxPos + 1]) << 16) >> 16
      bboxPos += 8
    } else {
      out[o + 2] = xMin >> 8
      out[o + 3] = xMin
      out[o + 4] = yMin >> 8
      out[o + 5] = yMin
      out[o + 6] = xMax >> 8
      out[o + 7] = xMax
      out[o + 8] = yMax >> 8
      out[o + 9] = yMax
    }
    xMins[glyphId] = xMin

    out[w] = instructionSize >> 8
    out[w + 1] = instructionSize
    w += 2
    copyBytes(out, w, data, instructionPos, instructionSize)
    instructionPos += instructionSize
    w += instructionSize

    copyBytes(out, w, flagsScratch, 0, flagsLen)
    w += flagsLen
    copyBytes(out, w, xScratch, 0, xLen)
    w += xLen
    copyBytes(out, w, yScratch, 0, yLen)

    o = (o + glyphSize + 3) & ~3
  }

  const glyfLength = o - outStart
  locaValues[numGlyphs] = glyfLength

  const locaData = new Uint8Array((numGlyphs + 1) * (indexFormat ? 4 : 2))
  if (indexFormat) {
    for (let i = 0, p = 0; i <= numGlyphs; i++, p += 4) {
      const v = locaValues[i]
      locaData[p] = v >>> 24
      locaData[p + 1] = v >>> 16
      locaData[p + 2] = v >>> 8
      locaData[p + 3] = v
    }
  } else {
    for (let i = 0, p = 0; i <= numGlyphs; i++, p += 2) {
      const v = locaValues[i] >> 1
      locaData[p] = v >> 8
      locaData[p + 1] = v
    }
  }

  return { out, glyfLength, locaData, numGlyphs, indexFormat, xMins }
}
