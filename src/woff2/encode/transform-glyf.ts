// WOFF2 glyf/loca transform (section 5.1-5.2)
// Goes straight from glyf bytes to the substreams, no parsed glyph objects

import { SfntFont, GlyphInfo } from './sfnt'
import { TAG_GLYF } from '../../shared/known-tags'

export interface TransformedGlyf {
  data: Uint8Array
  origLength: number
}

// TrueType simple glyph flags
const FLAG_ON_CURVE = 0x01
const FLAG_X_SHORT = 0x02
const FLAG_Y_SHORT = 0x04
const FLAG_REPEAT = 0x08
const FLAG_X_SAME_OR_POSITIVE = 0x10
const FLAG_Y_SAME_OR_POSITIVE = 0x20
const FLAG_OVERLAP_SIMPLE = 0x40

// Composite glyph flags
const COMP_ARG_1_AND_2_ARE_WORDS = 0x0001
const COMP_WE_HAVE_A_SCALE = 0x0008
const COMP_MORE_COMPONENTS = 0x0020
const COMP_WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const COMP_WE_HAVE_A_TWO_BY_TWO = 0x0080
const COMP_WE_HAVE_INSTRUCTIONS = 0x0100

// Below this size a loop beats set(subarray()), which allocates a view
const SMALL_COPY = 48

function grow(buf: Uint8Array, used: number, needed: number) {
  const next = new Uint8Array(Math.max(buf.byteLength * 2, used + needed))
  next.set(buf.subarray(0, used))
  return next
}

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

// Caller reserves 3 bytes. Returns the new position
function write255UShort(buf: Uint8Array, pos: number, value: number): number {
  if (value < 253) {
    buf[pos++] = value
  } else if (value < 506) {
    buf[pos++] = 255
    buf[pos++] = value - 253
  } else if (value < 762) {
    buf[pos++] = 254
    buf[pos++] = value - 506
  } else {
    buf[pos++] = 253
    buf[pos++] = value >> 8
    buf[pos++] = value
  }
  return pos
}

// Transform glyf table to WOFF2 format
export function transformGlyf(font: SfntFont, glyphInfo: GlyphInfo): TransformedGlyf {
  const { numGlyphs, indexFormat, glyphOffsets } = glyphInfo

  const glyfEntry = font.tables.get(TAG_GLYF)
  if (!glyfEntry) {
    throw new Error('Missing glyf table')
  }
  const data = font.data
  const glyfOffset = glyfEntry.offset
  const origLength = glyfEntry.length
  if (glyfOffset + origLength > data.byteLength) {
    throw new Error('glyf table truncated')
  }

  // Initial sizes are guesses. Each stream reserves what a glyph can need
  // before writing it, so writes inside a glyph are unchecked
  const nContourStream = new Uint8Array(numGlyphs * 2)
  let nPointsStream = new Uint8Array(Math.max(64, origLength >> 4))
  let nPointsLen = 0
  let flagStream = new Uint8Array(Math.max(64, origLength >> 2))
  let flagLen = 0
  let glyphStream = new Uint8Array(Math.max(64, origLength >> 1))
  let glyphLen = 0
  let compositeStream = new Uint8Array(Math.max(64, origLength >> 4))
  let compositeLen = 0
  let bboxStream = new Uint8Array(Math.max(64, numGlyphs * 2))
  let bboxLen = 0
  let instructionStream = new Uint8Array(Math.max(64, origLength >> 2))
  let instructionLen = 0

  // One bit per glyph
  const bboxBitmapLength = ((numGlyphs + 31) >> 5) << 2
  const bboxBitmap = new Uint8Array(bboxBitmapLength)
  const overlapBitmap = new Uint8Array((numGlyphs + 7) >> 3)
  let hasAnyOverlap = false

  // Run-length flags expanded to one per point
  let flagScratch = new Uint8Array(1024)

  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    const glyphOffset = glyphOffsets[glyphId]
    const glyphLength = glyphOffsets[glyphId + 1] - glyphOffset
    if (glyphLength === 0) continue
    if (glyphLength < 10 || glyphOffset + glyphLength > origLength) {
      throw new Error(`Invalid glyph ${glyphId}`)
    }

    const start = glyfOffset + glyphOffset
    const glyphEnd = start + glyphLength
    const nContours = (((data[start] << 8) | data[start + 1]) << 16) >> 16

    // A zero-contour glyph has no outline. The decoder reads nothing for
    // nContours 0, so anything written here would desync the streams
    if (nContours === 0) continue

    nContourStream[glyphId * 2] = nContours >> 8
    nContourStream[glyphId * 2 + 1] = nContours
    const bit = 0x80 >> (glyphId & 7)

    if (nContours < 0) {
      if (nContours !== -1) throw new Error(`Invalid nContours: ${nContours}`)

      // Composite always has an explicit bbox
      bboxBitmap[glyphId >> 3] |= bit
      if (bboxLen + 8 > bboxStream.byteLength) bboxStream = grow(bboxStream, bboxLen, 8)
      for (let i = 0; i < 8; i++) bboxStream[bboxLen + i] = data[start + 2 + i]
      bboxLen += 8

      let p = start + 10
      let haveInstructions = false
      let flags = COMP_MORE_COMPONENTS
      while (flags & COMP_MORE_COMPONENTS) {
        if (p + 2 > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)
        flags = (data[p] << 8) | data[p + 1]
        if (flags & COMP_WE_HAVE_INSTRUCTIONS) haveInstructions = true

        // flags + glyph index + args, then optional transform
        let size = flags & COMP_ARG_1_AND_2_ARE_WORDS ? 8 : 6
        if (flags & COMP_WE_HAVE_A_SCALE) size += 2
        else if (flags & COMP_WE_HAVE_AN_X_AND_Y_SCALE) size += 4
        else if (flags & COMP_WE_HAVE_A_TWO_BY_TWO) size += 8
        p += size
      }
      if (p > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)

      const length = p - (start + 10)
      if (compositeLen + length > compositeStream.byteLength) {
        compositeStream = grow(compositeStream, compositeLen, length)
      }
      copyBytes(compositeStream, compositeLen, data, start + 10, length)
      compositeLen += length

      if (haveInstructions) {
        if (p + 2 > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)
        const instructionLength = (data[p] << 8) | data[p + 1]
        p += 2
        if (p + instructionLength > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)

        if (glyphLen + 3 > glyphStream.byteLength) glyphStream = grow(glyphStream, glyphLen, 3)
        glyphLen = write255UShort(glyphStream, glyphLen, instructionLength)

        if (instructionLen + instructionLength > instructionStream.byteLength) {
          instructionStream = grow(instructionStream, instructionLen, instructionLength)
        }
        copyBytes(instructionStream, instructionLen, data, p, instructionLength)
        instructionLen += instructionLength
      }
      continue
    }

    // Simple glyph
    let p = start + 10
    if (p + nContours * 2 + 2 > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)

    if (nPointsLen + nContours * 3 > nPointsStream.byteLength) {
      nPointsStream = grow(nPointsStream, nPointsLen, nContours * 3)
    }
    let prevEnd = -1
    for (let i = 0; i < nContours; i++) {
      const endPoint = (data[p] << 8) | data[p + 1]
      p += 2
      if (endPoint < prevEnd) throw new Error(`Invalid glyph ${glyphId}`)
      nPointsLen = write255UShort(nPointsStream, nPointsLen, endPoint - prevEnd)
      prevEnd = endPoint
    }
    const numPoints = prevEnd + 1

    const instructionLength = (data[p] << 8) | data[p + 1]
    p += 2
    const instructionStart = p
    p += instructionLength

    // glyf stores all x deltas, then all y deltas. Expanding the flags first
    // gives the x byte count, so x and y can then be read side by side
    if (numPoints > flagScratch.byteLength) flagScratch = new Uint8Array(numPoints * 2)
    let flagCount = 0
    let xBytes = 0
    while (flagCount < numPoints) {
      if (p >= glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)
      const flag = data[p++]
      const xSize = flag & FLAG_X_SHORT ? 1 : flag & FLAG_X_SAME_OR_POSITIVE ? 0 : 2
      flagScratch[flagCount++] = flag
      xBytes += xSize
      if (flag & FLAG_REPEAT) {
        let repeat = data[p++]
        if (repeat > numPoints - flagCount) repeat = numPoints - flagCount
        xBytes += xSize * repeat
        for (const stop = flagCount + repeat; flagCount < stop; flagCount++) {
          flagScratch[flagCount] = flag
        }
      }
    }
    let xPos = p
    let yPos = p + xBytes

    if (numPoints > 0 && (flagScratch[0] & FLAG_OVERLAP_SIMPLE) !== 0) {
      overlapBitmap[glyphId >> 3] |= bit
      hasAnyOverlap = true
    }

    // At most 1 flag and 4 coordinate bytes per point, plus the instruction length
    if (flagLen + numPoints > flagStream.byteLength) {
      flagStream = grow(flagStream, flagLen, numPoints)
    }
    if (glyphLen + numPoints * 4 + 3 > glyphStream.byteLength) {
      glyphStream = grow(glyphStream, glyphLen, numPoints * 4 + 3)
    }

    let x = 0
    let y = 0
    let xMin = 0
    let yMin = 0
    let xMax = 0
    let yMax = 0
    if (numPoints > 0) {
      xMin = yMin = 0x7fffffff
      xMax = yMax = -0x80000000
    }

    for (let i = 0; i < numPoints; i++) {
      const flag = flagScratch[i]

      let dx = 0
      if (flag & FLAG_X_SHORT) {
        dx = flag & FLAG_X_SAME_OR_POSITIVE ? data[xPos] : -data[xPos]
        xPos++
      } else if (!(flag & FLAG_X_SAME_OR_POSITIVE)) {
        dx = (((data[xPos] << 8) | data[xPos + 1]) << 16) >> 16
        xPos += 2
      }

      let dy = 0
      if (flag & FLAG_Y_SHORT) {
        dy = flag & FLAG_Y_SAME_OR_POSITIVE ? data[yPos] : -data[yPos]
        yPos++
      } else if (!(flag & FLAG_Y_SAME_OR_POSITIVE)) {
        dy = (((data[yPos] << 8) | data[yPos + 1]) << 16) >> 16
        yPos += 2
      }

      x += dx
      y += dy
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y

      // Triplet encoding (spec table 2), smallest form that fits
      const absDx = dx < 0 ? -dx : dx
      const absDy = dy < 0 ? -dy : dy
      const onCurveBit = flag & FLAG_ON_CURVE ? 0 : 0x80
      const xSign = dx >= 0 ? 1 : 0
      const ySign = dy >= 0 ? 1 : 0
      const xySign = xSign | (ySign << 1)

      if (dx === 0 && absDy < 1280) {
        flagStream[flagLen++] = onCurveBit | ((absDy >> 7) & 0x0e) | ySign
        glyphStream[glyphLen++] = absDy
      } else if (dy === 0 && absDx < 1280) {
        flagStream[flagLen++] = onCurveBit | 10 | ((absDx >> 7) & 0x0e) | xSign
        glyphStream[glyphLen++] = absDx
      } else if (absDx < 65 && absDy < 65) {
        flagStream[flagLen++] =
          onCurveBit | 20 | ((absDx - 1) & 0x30) | (((absDy - 1) & 0x30) >> 2) | xySign
        glyphStream[glyphLen++] = (((absDx - 1) & 0x0f) << 4) | ((absDy - 1) & 0x0f)
      } else if (absDx < 769 && absDy < 769) {
        flagStream[flagLen++] =
          onCurveBit | 84 | (((absDx - 1) >> 8) * 12) | (((absDy - 1) >> 6) & 0x0c) | xySign
        glyphStream[glyphLen++] = absDx - 1
        glyphStream[glyphLen++] = absDy - 1
      } else if (absDx < 4096 && absDy < 4096) {
        flagStream[flagLen++] = onCurveBit | 120 | xySign
        glyphStream[glyphLen++] = absDx >> 4
        glyphStream[glyphLen++] = ((absDx & 0x0f) << 4) | (absDy >> 8)
        glyphStream[glyphLen++] = absDy
      } else {
        flagStream[flagLen++] = onCurveBit | 124 | xySign
        glyphStream[glyphLen++] = absDx >> 8
        glyphStream[glyphLen++] = absDx
        glyphStream[glyphLen++] = absDy >> 8
        glyphStream[glyphLen++] = absDy
      }
    }
    if (yPos > glyphEnd) throw new Error(`Invalid glyph ${glyphId}`)

    glyphLen = write255UShort(glyphStream, glyphLen, instructionLength)
    if (instructionLen + instructionLength > instructionStream.byteLength) {
      instructionStream = grow(instructionStream, instructionLen, instructionLength)
    }
    copyBytes(instructionStream, instructionLen, data, instructionStart, instructionLength)
    instructionLen += instructionLength

    // Explicit bbox only when the stored one differs from the computed one
    const storedXMin = (((data[start + 2] << 8) | data[start + 3]) << 16) >> 16
    const storedYMin = (((data[start + 4] << 8) | data[start + 5]) << 16) >> 16
    const storedXMax = (((data[start + 6] << 8) | data[start + 7]) << 16) >> 16
    const storedYMax = (((data[start + 8] << 8) | data[start + 9]) << 16) >> 16
    if (storedXMin !== xMin || storedYMin !== yMin || storedXMax !== xMax || storedYMax !== yMax) {
      bboxBitmap[glyphId >> 3] |= bit
      if (bboxLen + 8 > bboxStream.byteLength) bboxStream = grow(bboxStream, bboxLen, 8)
      for (let i = 0; i < 8; i++) bboxStream[bboxLen + i] = data[start + 2 + i]
      bboxLen += 8
    }
  }

  const overlapLen = hasAnyOverlap ? overlapBitmap.byteLength : 0
  const output = new Uint8Array(
    36 +
      nContourStream.byteLength +
      nPointsLen +
      flagLen +
      glyphLen +
      compositeLen +
      bboxBitmapLength +
      bboxLen +
      instructionLen +
      overlapLen
  )
  const view = new DataView(output.buffer)

  // Header, version 0 at offset 0
  view.setUint16(2, hasAnyOverlap ? 1 : 0) // optionFlags
  view.setUint16(4, numGlyphs)
  view.setUint16(6, indexFormat)
  view.setUint32(8, nContourStream.byteLength)
  view.setUint32(12, nPointsLen)
  view.setUint32(16, flagLen)
  view.setUint32(20, glyphLen)
  view.setUint32(24, compositeLen)
  view.setUint32(28, bboxBitmapLength + bboxLen)
  view.setUint32(32, instructionLen)

  let o = 36
  output.set(nContourStream, o)
  o += nContourStream.byteLength
  output.set(nPointsStream.subarray(0, nPointsLen), o)
  o += nPointsLen
  output.set(flagStream.subarray(0, flagLen), o)
  o += flagLen
  output.set(glyphStream.subarray(0, glyphLen), o)
  o += glyphLen
  output.set(compositeStream.subarray(0, compositeLen), o)
  o += compositeLen
  output.set(bboxBitmap, o)
  o += bboxBitmapLength
  output.set(bboxStream.subarray(0, bboxLen), o)
  o += bboxLen
  output.set(instructionStream.subarray(0, instructionLen), o)
  o += instructionLen
  if (hasAnyOverlap) output.set(overlapBitmap, o)

  return { data: output, origLength }
}
