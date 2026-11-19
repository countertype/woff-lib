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
