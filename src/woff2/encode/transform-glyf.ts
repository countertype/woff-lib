// WOFF2 glyf/loca transform (section 5.1-5.2)
// Encodes TrueType glyphs using triplet encoding

import { WriteBuffer } from './write-buffer'
import {
  SfntFont,
  GlyphInfo,
  SimpleGlyph,
  CompositeGlyph,
  parseGlyph,
} from './sfnt'
import { TAG_GLYF } from '../../shared/known-tags'

export interface TransformedGlyf {
  data: Uint8Array
  origLength: number
}

// Transform glyf table to WOFF2 format
export function transformGlyf(
  font: SfntFont,
  glyphInfo: GlyphInfo
): TransformedGlyf {
  const { numGlyphs, indexFormat, glyphOffsets } = glyphInfo

  const glyfEntry = font.tables.get(TAG_GLYF)
  if (!glyfEntry) {
    throw new Error('Missing glyf table')
  }
  const glyfOffset = glyfEntry.offset
  const origLength = glyfEntry.length

  // Pre-allocate streams with estimated sizes
  const nContourStream = new WriteBuffer(numGlyphs * 2)
  const nPointsStream = new WriteBuffer(numGlyphs * 4)
  const flagStream = new WriteBuffer(numGlyphs * 100)
  const glyphStream = new WriteBuffer(numGlyphs * 200)
  const compositeStream = new WriteBuffer(numGlyphs * 20)
  const bboxStream = new WriteBuffer(numGlyphs * 8)
  const instructionStream = new WriteBuffer(numGlyphs * 50)

  // Bbox bitmap - one bit per glyph
  const bboxBitmapLength = ((numGlyphs + 31) >> 5) << 2
  const bboxBitmap = new Uint8Array(bboxBitmapLength)

  // Overlap bitmap - one bit per glyph
  let hasAnyOverlap = false
  const overlapBitmap = new Uint8Array((numGlyphs + 7) >> 3)

  // Collect xMins for loca reconstruction check
  const xMins = new Int16Array(numGlyphs)

  // Process each glyph
  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    const offset = glyphOffsets[glyphId]
    const length = glyphOffsets[glyphId + 1] - offset

    const glyph = parseGlyph(font, glyfOffset, offset, length)

    if (glyph === null) {
      // Empty glyph
      nContourStream.writeS16(0)
      continue
    }

    if ('nContours' in glyph && glyph.nContours >= 0) {
      // Simple glyph
      encodeSimpleGlyph(
        glyph,
        glyphId,
        nContourStream,
        nPointsStream,
        flagStream,
        glyphStream,
        bboxStream,
        bboxBitmap,
        instructionStream,
        overlapBitmap,
        xMins
      )
      if (glyph.hasOverlapFlag) {
        hasAnyOverlap = true
      }
    } else {
      // Composite glyph
      const comp = glyph as CompositeGlyph
      encodeCompositeGlyph(
        comp,
        glyphId,
        nContourStream,
        glyphStream,
        compositeStream,
        bboxStream,
        bboxBitmap,
        instructionStream,
        xMins
      )
    }
  }

  // Build transformed glyf output
  const output = new WriteBuffer(
    44 + // header
    nContourStream.offset +
    nPointsStream.offset +
    flagStream.offset +
    glyphStream.offset +
    compositeStream.offset +
    bboxBitmapLength +
    bboxStream.offset +
    instructionStream.offset +
    (hasAnyOverlap ? overlapBitmap.byteLength : 0)
  )

  // Write header
  output.writeU16(0) // version
  output.writeU16(hasAnyOverlap ? 1 : 0) // optionFlags
  output.writeU16(numGlyphs)
  output.writeU16(indexFormat)
  output.writeU32(nContourStream.offset)
  output.writeU32(nPointsStream.offset)
  output.writeU32(flagStream.offset)
  output.writeU32(glyphStream.offset)
  output.writeU32(compositeStream.offset)
  output.writeU32(bboxBitmapLength + bboxStream.offset)
  output.writeU32(instructionStream.offset)

  // Write streams
  output.writeBytes(nContourStream.getBytes())
  output.writeBytes(nPointsStream.getBytes())
  output.writeBytes(flagStream.getBytes())
  output.writeBytes(glyphStream.getBytes())
  output.writeBytes(compositeStream.getBytes())
  output.writeBytes(bboxBitmap)
  output.writeBytes(bboxStream.getBytes())
  output.writeBytes(instructionStream.getBytes())

  if (hasAnyOverlap) {
    output.writeBytes(overlapBitmap)
  }

  return {
    data: output.getBytes(),
    origLength,
  }
}

function encodeSimpleGlyph(
  glyph: SimpleGlyph,
  glyphId: number,
  nContourStream: WriteBuffer,
  nPointsStream: WriteBuffer,
  flagStream: WriteBuffer,
  glyphStream: WriteBuffer,
  bboxStream: WriteBuffer,
  bboxBitmap: Uint8Array,
  instructionStream: WriteBuffer,
  overlapBitmap: Uint8Array,
  xMins: Int16Array
): void {
  const { nContours, endPtsOfContours, instructions, xCoordinates, yCoordinates, flags, hasOverlapFlag } = glyph

  // Write nContours
  nContourStream.writeS16(nContours)

  // Store xMin
  xMins[glyphId] = glyph.xMin

  // Check if bbox matches computed bbox (can be different due to phantom points)
  const computedBbox = computeBbox(xCoordinates, yCoordinates)
  const bboxMatches =
    computedBbox.xMin === glyph.xMin &&
    computedBbox.yMin === glyph.yMin &&
    computedBbox.xMax === glyph.xMax &&
    computedBbox.yMax === glyph.yMax

  if (!bboxMatches) {
    // Write explicit bbox
    bboxBitmap[glyphId >> 3] |= 0x80 >> (glyphId & 7)
    bboxStream.writeS16(glyph.xMin)
    bboxStream.writeS16(glyph.yMin)
    bboxStream.writeS16(glyph.xMax)
    bboxStream.writeS16(glyph.yMax)
  }

  // Track overlap flag
  if (hasOverlapFlag) {
    overlapBitmap[glyphId >> 3] |= 0x80 >> (glyphId & 7)
  }

  // Write nPoints per contour
  let prevEnd = -1
  for (let i = 0; i < nContours; i++) {
    const nPoints = endPtsOfContours[i] - prevEnd
    nPointsStream.write255UShort(nPoints)
    prevEnd = endPtsOfContours[i]
  }

  // Write triplets (flag + coordinates)
  const totalPoints = endPtsOfContours[nContours - 1] + 1
  let lastX = 0
  let lastY = 0

  for (let i = 0; i < totalPoints; i++) {
    const dx = xCoordinates[i] - lastX
    const dy = yCoordinates[i] - lastY
    const isOnCurve = (flags[i] & 1) !== 0

    writeTriplet(flagStream, glyphStream, isOnCurve, dx, dy)

    lastX = xCoordinates[i]
    lastY = yCoordinates[i]
  }

  // Write instruction length and instructions
  glyphStream.write255UShort(instructions.byteLength)
  instructionStream.writeBytes(instructions)
}

function computeBbox(xCoordinates: Int16Array, yCoordinates: Int16Array): {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
} {
  if (xCoordinates.length === 0) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  }

  let xMin = xCoordinates[0]
  let yMin = yCoordinates[0]
  let xMax = xCoordinates[0]
  let yMax = yCoordinates[0]

  for (let i = 1; i < xCoordinates.length; i++) {
    const x = xCoordinates[i]
    const y = yCoordinates[i]
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    if (y > yMax) yMax = y
  }

  return { xMin, yMin, xMax, yMax }
}

function encodeCompositeGlyph(
  glyph: CompositeGlyph,
  glyphId: number,
  nContourStream: WriteBuffer,
  glyphStream: WriteBuffer,
  compositeStream: WriteBuffer,
  bboxStream: WriteBuffer,
  bboxBitmap: Uint8Array,
  instructionStream: WriteBuffer,
  xMins: Int16Array
): void {
  // Write -1 for composite
  nContourStream.writeS16(-1)

  // Store xMin
  xMins[glyphId] = glyph.xMin

  // Composite always has explicit bbox
  bboxBitmap[glyphId >> 3] |= 0x80 >> (glyphId & 7)
  bboxStream.writeS16(glyph.xMin)
  bboxStream.writeS16(glyph.yMin)
  bboxStream.writeS16(glyph.xMax)
  bboxStream.writeS16(glyph.yMax)

  // Write composite data
  compositeStream.writeBytes(glyph.compositeData)

  // Write instructions if present
  if (glyph.haveInstructions && glyph.instructions) {
    glyphStream.write255UShort(glyph.instructions.byteLength)
    instructionStream.writeBytes(glyph.instructions)
  }
}

// Write a point as WOFF2 triplet encoding
// Reference: WOFF2 spec table 2
function writeTriplet(
  flagStream: WriteBuffer,
  glyphStream: WriteBuffer,
  onCurve: boolean,
  dx: number,
  dy: number
): void {
  const absDx = dx < 0 ? -dx : dx
  const absDy = dy < 0 ? -dy : dy
  const onCurveBit = onCurve ? 0 : 0x80
  const xSign = dx >= 0 ? 1 : 0
  const ySign = dy >= 0 ? 1 : 0

  // Case 1: dx=0, dy in [0, 1280)
  if (dx === 0 && absDy < 1280) {
    flagStream.writeU8Fast(onCurveBit | ((absDy >> 7) & 0x0e) | ySign)
    glyphStream.writeU8Fast(absDy & 0xff)
    return
  }

  // Case 2: dy=0, dx in [0, 1280)
  if (dy === 0 && absDx < 1280) {
    flagStream.writeU8Fast(onCurveBit | 10 | ((absDx >> 7) & 0x0e) | xSign)
    glyphStream.writeU8Fast(absDx & 0xff)
    return
  }

  // Case 3: Both small, 4 bits each [1, 65]
  if (absDx > 0 && absDx < 65 && absDy > 0 && absDy < 65) {
    const xySign = xSign | (ySign << 1)
    flagStream.writeU8Fast(
      onCurveBit | 20 |
      ((absDx - 1) & 0x30) |
      (((absDy - 1) & 0x30) >> 2) |
      xySign
    )
    glyphStream.writeU8Fast((((absDx - 1) & 0x0f) << 4) | ((absDy - 1) & 0x0f))
    return
  }

  // Case 4: Medium [1, 769]
  if (absDx > 0 && absDx < 769 && absDy > 0 && absDy < 769) {
    const xySign = xSign | (ySign << 1)
    flagStream.writeU8Fast(
      onCurveBit | 84 |
      (((absDx - 1) >> 8) * 12) |
      (((absDy - 1) >> 6) & 0x0c) |
      xySign
    )
    glyphStream.writeU8Fast((absDx - 1) & 0xff)
    glyphStream.writeU8Fast((absDy - 1) & 0xff)
    return
  }

  // Case 5: Large [0, 4096)
  if (absDx < 4096 && absDy < 4096) {
    const xySign = xSign | (ySign << 1)
    flagStream.writeU8Fast(onCurveBit | 120 | xySign)
    glyphStream.writeU8Fast(absDx >> 4)
    glyphStream.writeU8Fast(((absDx & 0x0f) << 4) | (absDy >> 8))
    glyphStream.writeU8Fast(absDy & 0xff)
    return
  }

  // Case 6: Full 16-bit
  const xySign = xSign | (ySign << 1)
  flagStream.writeU8Fast(onCurveBit | 124 | xySign)
  glyphStream.writeU8Fast(absDx >> 8)
  glyphStream.writeU8Fast(absDx & 0xff)
  glyphStream.writeU8Fast(absDy >> 8)
  glyphStream.writeU8Fast(absDy & 0xff)
}

