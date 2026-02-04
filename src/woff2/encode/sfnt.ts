// SFNT (TTF/OTF) parser for encoding

import {
  TAG_HEAD,
  TAG_MAXP,
  TAG_HHEA,
  TAG_LOCA,
  TAG_CFF,
  TAG_CFF2,
  SFNT_TTF,
  SFNT_CFF,
} from '../../shared/known-tags'

export interface SfntTable {
  tag: number
  checksum: number
  offset: number
  length: number
}

export interface SfntFont {
  flavor: number
  tables: Map<number, SfntTable>
  data: Uint8Array
  view: DataView
}

export interface GlyphInfo {
  numGlyphs: number
  indexFormat: number  // 0 = short (uint16), 1 = long (uint32)
  glyphOffsets: Uint32Array
}

// Parse SFNT font
export function parseSfnt(data: Uint8Array): SfntFont {
  if (data.byteLength < 12) {
    throw new Error('Buffer too small for SFNT header')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flavor = view.getUint32(0)

  if (flavor !== SFNT_TTF && flavor !== SFNT_CFF) {
    throw new Error(`Unknown SFNT signature: 0x${flavor.toString(16)}`)
  }

  const numTables = view.getUint16(4)
  const tables = new Map<number, SfntTable>()

  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16

    if (recordOffset + 16 > data.byteLength) {
      throw new Error('Table directory truncated')
    }

    const tag = view.getUint32(recordOffset)
    const checksum = view.getUint32(recordOffset + 4)
    const offset = view.getUint32(recordOffset + 8)
    const length = view.getUint32(recordOffset + 12)

    tables.set(tag, { tag, checksum, offset, length })
  }

  return { flavor, tables, data, view }
}

// Get table data as Uint8Array slice (zero-copy)
export function getTableData(font: SfntFont, tag: number): Uint8Array | null {
  const entry = font.tables.get(tag)
  if (!entry) return null
  return font.data.subarray(entry.offset, entry.offset + entry.length)
}

// Check if font has CFF outlines (vs TrueType)
export function isCff(font: SfntFont): boolean {
  return font.tables.has(TAG_CFF) || font.tables.has(TAG_CFF2)
}

// Read numGlyphs from maxp table
export function getNumGlyphs(font: SfntFont): number {
  const maxp = font.tables.get(TAG_MAXP)
  if (!maxp || maxp.length < 6) {
    throw new Error('Missing or invalid maxp table')
  }
  return font.view.getUint16(maxp.offset + 4)
}

// Read indexToLocFormat from head table (0 = short, 1 = long)
export function getIndexToLocFormat(font: SfntFont): number {
  const head = font.tables.get(TAG_HEAD)
  if (!head || head.length < 54) {
    throw new Error('Missing or invalid head table')
  }
  return font.view.getInt16(head.offset + 50)
}

// Read numHMetrics from hhea table
export function getNumHMetrics(font: SfntFont): number {
  const hhea = font.tables.get(TAG_HHEA)
  if (!hhea || hhea.length < 36) {
    throw new Error('Missing or invalid hhea table')
  }
  return font.view.getUint16(hhea.offset + 34)
}

// Parse loca table to get glyph offsets
export function parseLocaTable(font: SfntFont): Uint32Array {
  const numGlyphs = getNumGlyphs(font)
  const indexFormat = getIndexToLocFormat(font)
  
  const loca = font.tables.get(TAG_LOCA)
  if (!loca) {
    throw new Error('Missing loca table')
  }

  const offsets = new Uint32Array(numGlyphs + 1)
  const locaOffset = loca.offset

  if (indexFormat === 0) {
    // Short format: uint16, multiply by 2
    for (let i = 0; i <= numGlyphs; i++) {
      offsets[i] = font.view.getUint16(locaOffset + i * 2) * 2
    }
  } else {
    // Long format: uint32
    for (let i = 0; i <= numGlyphs; i++) {
      offsets[i] = font.view.getUint32(locaOffset + i * 4)
    }
  }

  return offsets
}

// Get glyph info for encoding
export function getGlyphInfo(font: SfntFont): GlyphInfo {
  const numGlyphs = getNumGlyphs(font)
  const indexFormat = getIndexToLocFormat(font)
  const glyphOffsets = parseLocaTable(font)

  return { numGlyphs, indexFormat, glyphOffsets }
}

// TrueType glyph flags
export const FLAG_ON_CURVE = 0x01
export const FLAG_X_SHORT = 0x02
export const FLAG_Y_SHORT = 0x04
export const FLAG_REPEAT = 0x08
export const FLAG_X_SAME_OR_POSITIVE = 0x10
export const FLAG_Y_SAME_OR_POSITIVE = 0x20
export const FLAG_OVERLAP_SIMPLE = 0x40

// Composite glyph flags
export const COMP_ARG_1_AND_2_ARE_WORDS = 0x0001
export const COMP_WE_HAVE_A_SCALE = 0x0008
export const COMP_MORE_COMPONENTS = 0x0020
export const COMP_WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
export const COMP_WE_HAVE_A_TWO_BY_TWO = 0x0080
export const COMP_WE_HAVE_INSTRUCTIONS = 0x0100

// Parsed simple glyph
export interface SimpleGlyph {
  nContours: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  endPtsOfContours: Uint16Array
  instructions: Uint8Array
  xCoordinates: Int16Array  // Absolute X coordinates
  yCoordinates: Int16Array  // Absolute Y coordinates
  flags: Uint8Array         // Original flags (bit 0 = on curve)
  hasOverlapFlag: boolean
}

// Parsed composite glyph
export interface CompositeGlyph {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  compositeData: Uint8Array
  instructions: Uint8Array | null
  haveInstructions: boolean
}

export type ParsedGlyph = SimpleGlyph | CompositeGlyph | null

// Parse a single glyph from glyf table
export function parseGlyph(
  font: SfntFont,
  glyfOffset: number,
  glyphOffset: number,
  glyphLength: number
): ParsedGlyph {
  if (glyphLength === 0) {
    return null // Empty glyph
  }

  const view = font.view
  const start = glyfOffset + glyphOffset

  const nContours = view.getInt16(start)
  const xMin = view.getInt16(start + 2)
  const yMin = view.getInt16(start + 4)
  const xMax = view.getInt16(start + 6)
  const yMax = view.getInt16(start + 8)

  if (nContours >= 0) {
    return parseSimpleGlyph(font, start, nContours, xMin, yMin, xMax, yMax)
  } else if (nContours === -1) {
    return parseCompositeGlyph(font, start, xMin, yMin, xMax, yMax, glyphLength)
  }

  throw new Error(`Invalid nContours: ${nContours}`)
}

function parseSimpleGlyph(
  font: SfntFont,
  start: number,
  nContours: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number
): SimpleGlyph {
  const view = font.view
  const data = font.data
  let pos = start + 10

  // Read endPtsOfContours
  const endPtsOfContours = new Uint16Array(nContours)
  for (let i = 0; i < nContours; i++) {
    endPtsOfContours[i] = view.getUint16(pos)
    pos += 2
  }

  const numPoints = nContours > 0 ? endPtsOfContours[nContours - 1] + 1 : 0

  // Read instructions
  const instructionLength = view.getUint16(pos)
  pos += 2
  const instructions = data.subarray(pos, pos + instructionLength)
  pos += instructionLength

  // Read flags (run-length encoded)
  const flags = new Uint8Array(numPoints)
  let flagIndex = 0
  while (flagIndex < numPoints) {
    const flag = data[pos++]
    flags[flagIndex++] = flag

    if (flag & FLAG_REPEAT) {
      const repeatCount = data[pos++]
      for (let j = 0; j < repeatCount && flagIndex < numPoints; j++) {
        flags[flagIndex++] = flag
      }
    }
  }

  const hasOverlapFlag = numPoints > 0 && (flags[0] & FLAG_OVERLAP_SIMPLE) !== 0

  // Read X coordinates
  const xCoordinates = new Int16Array(numPoints)
  let x = 0
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i]
    if (flag & FLAG_X_SHORT) {
      const dx = data[pos++]
      x += (flag & FLAG_X_SAME_OR_POSITIVE) ? dx : -dx
    } else if (!(flag & FLAG_X_SAME_OR_POSITIVE)) {
      x += view.getInt16(pos)
      pos += 2
    }
    xCoordinates[i] = x
  }

  // Read Y coordinates
  const yCoordinates = new Int16Array(numPoints)
  let y = 0
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i]
    if (flag & FLAG_Y_SHORT) {
      const dy = data[pos++]
      y += (flag & FLAG_Y_SAME_OR_POSITIVE) ? dy : -dy
    } else if (!(flag & FLAG_Y_SAME_OR_POSITIVE)) {
      y += view.getInt16(pos)
      pos += 2
    }
    yCoordinates[i] = y
  }

  return {
    nContours,
    xMin,
    yMin,
    xMax,
    yMax,
    endPtsOfContours,
    instructions,
    xCoordinates,
    yCoordinates,
    flags,
    hasOverlapFlag,
  }
}

function parseCompositeGlyph(
  font: SfntFont,
  start: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  _glyphLength: number
): CompositeGlyph {
  const view = font.view
  const data = font.data
  let pos = start + 10
  const compositeStart = pos

  let haveInstructions = false
  let flags = COMP_MORE_COMPONENTS

  // Scan composite data
  while (flags & COMP_MORE_COMPONENTS) {
    flags = view.getUint16(pos)
    pos += 2

    haveInstructions = haveInstructions || (flags & COMP_WE_HAVE_INSTRUCTIONS) !== 0

    // Skip glyph index
    pos += 2

    // Skip arguments
    if (flags & COMP_ARG_1_AND_2_ARE_WORDS) {
      pos += 4
    } else {
      pos += 2
    }

    // Skip transformation matrix
    if (flags & COMP_WE_HAVE_A_SCALE) {
      pos += 2
    } else if (flags & COMP_WE_HAVE_AN_X_AND_Y_SCALE) {
      pos += 4
    } else if (flags & COMP_WE_HAVE_A_TWO_BY_TWO) {
      pos += 8
    }
  }

  const compositeData = data.subarray(compositeStart, pos)

  let instructions: Uint8Array | null = null
  if (haveInstructions) {
    const instructionLength = view.getUint16(pos)
    pos += 2
    instructions = data.subarray(pos, pos + instructionLength)
  }

  return {
    xMin,
    yMin,
    xMax,
    yMax,
    compositeData,
    instructions,
    haveInstructions,
  }
}
