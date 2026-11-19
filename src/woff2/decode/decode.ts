// WOFF2 decoder
// https://www.w3.org/TR/WOFF2/

import { decompress } from './brotli'
import { Buffer } from './buffer'
import { reconstructGlyf } from './reconstruct-glyf'
import { reconstructHmtx } from './reconstruct-hmtx'
import {
  KNOWN_TAGS,
  TAG_GLYF,
  TAG_LOCA,
  TAG_HMTX,
  TAG_HHEA,
  TAG_HEAD,
  TTC_FLAVOR,
  WOFF2_SIGNATURE,
  WOFF2_FLAGS_TRANSFORM,
  tagToString,
} from '../../shared/known-tags'
import { readBase128, read255UShort } from '../../shared/variable-length'
import { computeChecksum, pad4 } from '../../shared/checksum'

// SFNT constants
const SFNT_HEADER_SIZE = 12
const SFNT_ENTRY_SIZE = 16

interface Table {
  tag: number
  flags: number
  origLength: number
  transformLength: number
  srcOffset: number
  srcLength: number
  dstOffset: number
  dstLength: number
  key: string
}

interface FontInfo {
  numGlyphs: number
  indexFormat: number
  numHMetrics: number
  xMins: Int16Array
  tableEntryByTag: Map<number, number>
}

interface TtcFont {
  flavor: number
  dstOffset: number
  headerChecksum: number
  tableIndices: number[]
}

interface Woff2Header {
  flavor: number
  headerVersion: number
  numTables: number
  compressedOffset: number
  compressedLength: number
  uncompressedSize: number
  tables: Table[]
  ttcFonts: TtcFont[]
}

// Output buffer, replaced when a reconstructed table outgrows its declared size
interface Output {
  data: Uint8Array
  view: DataView
}

interface WrittenTable {
  dstOffset: number
  dstLength: number
  checksum: number
}

// Decode WOFF2 to TTF/OTF format
export async function woff2Decode(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data)
  const buf = new Buffer(input)

  // Read and validate header
  const header = readHeader(buf, input.byteLength)
  if (!header) {
    throw new Error('Failed to read WOFF2 header')
  }

  // Decompress table data
  const compressedData = input.subarray(
    header.compressedOffset,
    header.compressedOffset + header.compressedLength
  )

  const decompressed = await decompress(compressedData)
  if (!decompressed || decompressed.byteLength !== header.uncompressedSize) {
    throw new Error(
      `Brotli decompression failed: expected ${header.uncompressedSize} bytes, got ${decompressed?.byteLength ?? 0}`
    )
  }

  // Declared lengths are exact for everything except reconstructed glyf/loca
  const firstTableOffset = computeOffsetToFirstTable(header)
  let outputSize = firstTableOffset
  for (const table of header.tables) {
    outputSize += pad4(table.origLength)
  }

  const outData = new Uint8Array(outputSize)
  const out: Output = { data: outData, view: new DataView(outData.buffer) }

  // Write headers
  const fontInfos = writeHeaders(header, out.data, out.view)

  // Track written tables by tag/srcOffset for TTC table sharing
  const writtenTables = new Map<string, WrittenTable>()
  let end = firstTableOffset

  // Reconstruct font(s)
  if (header.ttcFonts.length > 0) {
    for (let i = 0; i < header.ttcFonts.length; i++) {
      end = reconstructFont(decompressed, header, i, fontInfos[i], out, writtenTables, end)
    }
  } else {
    end = reconstructFont(decompressed, header, 0, fontInfos[0], out, writtenTables, end)
  }

  return end === out.data.byteLength ? out.data : out.data.slice(0, end)
}

function ensureOutput(out: Output, size: number): void {
  if (size <= out.data.byteLength) return
  const data = new Uint8Array(Math.max(size, out.data.byteLength * 2))
  data.set(out.data)
  out.data = data
  out.view = new DataView(data.buffer)
}

function readHeader(buf: Buffer, totalLength: number): Woff2Header | null {
  const signature = buf.readU32()
  if (signature !== WOFF2_SIGNATURE) {
    return null
  }

  const flavor = buf.readU32()
  if (flavor === null) return null

  const length = buf.readU32()
  if (length === null || length !== totalLength) return null

  const numTables = buf.readU16()
  if (numTables === null || numTables === 0) return null

  // Skip reserved
  if (!buf.skip(2)) return null

  // Skip totalSfntSize (we compute it ourselves)
  if (!buf.skip(4)) return null

  const compressedLength = buf.readU32()
  if (compressedLength === null) return null

  // Skip majorVersion, minorVersion
  if (!buf.skip(4)) return null

  const metaOffset = buf.readU32()
  const metaLength = buf.readU32()
  const metaOrigLength = buf.readU32()
  if (metaOffset === null || metaLength === null || metaOrigLength === null) return null

  if (metaOffset !== 0) {
    if (metaOffset >= totalLength || totalLength - metaOffset < metaLength) {
      return null
    }
  }

  const privOffset = buf.readU32()
  const privLength = buf.readU32()
  if (privOffset === null || privLength === null) return null

  if (privOffset !== 0) {
    if (privOffset >= totalLength || totalLength - privOffset < privLength) {
      return null
    }
  }

  // Read table directory
  const tables = readTableDirectory(buf, numTables)
  if (!tables) return null

  // Calculate uncompressed size from last table
  const lastTable = tables[tables.length - 1]
  const uncompressedSize = lastTable.srcOffset + lastTable.srcLength

  let headerVersion = 0
  const ttcFonts: TtcFont[] = []

  // Handle TTC (font collection)
  if (flavor === TTC_FLAVOR) {
    headerVersion = buf.readU32() ?? 0
    if (headerVersion !== 0x00010000 && headerVersion !== 0x00020000) {
      return null
    }

    const numFonts = read255UShort(buf)
    if (numFonts === null || numFonts === 0) return null

    for (let i = 0; i < numFonts; i++) {
      const fontNumTables = read255UShort(buf)
      if (fontNumTables === null || fontNumTables === 0) return null

      const fontFlavor = buf.readU32()
      if (fontFlavor === null) return null

      const tableIndices: number[] = []
      for (let j = 0; j < fontNumTables; j++) {
        const idx = read255UShort(buf)
        if (idx === null || idx >= tables.length) return null
        tableIndices.push(idx)
      }

      ttcFonts.push({
        flavor: fontFlavor,
        dstOffset: 0,
        headerChecksum: 0,
        tableIndices,
      })
    }
  }

  return {
    flavor,
    headerVersion,
    numTables,
    compressedOffset: buf.offset,
    compressedLength,
    uncompressedSize,
    tables,
    ttcFonts,
  }
}

function readTableDirectory(buf: Buffer, numTables: number): Table[] | null {
  const tables: Table[] = []
  let srcOffset = 0

  for (let i = 0; i < numTables; i++) {
    const flagByte = buf.readU8()
    if (flagByte === null) return null

    let tag: number
    if ((flagByte & 0x3f) === 0x3f) {
      // Arbitrary tag follows
      tag = buf.readU32() ?? 0
      if (tag === 0) return null
    } else {
      tag = KNOWN_TAGS[flagByte & 0x3f]
    }

    const xformVersion = (flagByte >> 6) & 0x03
    let flags = 0

    // glyf/loca: xform version 0 means transform applied
    // others: xform version != 0 means transform applied
    if (tag === TAG_GLYF || tag === TAG_LOCA) {
      if (xformVersion === 0) {
        flags |= WOFF2_FLAGS_TRANSFORM
      }
    } else if (xformVersion !== 0) {
      flags |= WOFF2_FLAGS_TRANSFORM
    }
    flags |= xformVersion

    const origLength = readBase128(buf)
    if (origLength === null) return null

    let transformLength = origLength
    if ((flags & WOFF2_FLAGS_TRANSFORM) !== 0) {
      transformLength = readBase128(buf) ?? 0
      if (transformLength === 0 && tag !== TAG_LOCA) return null
      if (tag === TAG_LOCA && transformLength !== 0) return null
    }

    tables.push({
      tag,
      flags,
      origLength,
      transformLength,
      srcOffset,
      srcLength: transformLength,
      dstOffset: 0,
      dstLength: origLength,
      key: `${tag}:${srcOffset}`,
    })

    srcOffset += transformLength
  }

  return tables
}

function computeOffsetToFirstTable(header: Woff2Header): number {
  if (header.ttcFonts.length === 0) {
    return SFNT_HEADER_SIZE + SFNT_ENTRY_SIZE * header.numTables
  }

  // TTC header size
  let offset = 12 // ttcTag, version, numFonts
  offset += 4 * header.ttcFonts.length // offset table
  if (header.headerVersion === 0x00020000) {
    offset += 12 // DSIG fields
  }

  // Offset tables for each font
  for (const ttcFont of header.ttcFonts) {
    offset += SFNT_HEADER_SIZE
    offset += SFNT_ENTRY_SIZE * ttcFont.tableIndices.length
  }

  return offset
}

function writeHeaders(
  header: Woff2Header,
  output: Uint8Array,
  outView: DataView
): FontInfo[] {
  const fontInfos: FontInfo[] = []
  let offset = 0

  if (header.ttcFonts.length > 0) {
    // TTC header
    outView.setUint32(offset, header.flavor) // ttcTag
    offset += 4
    outView.setUint32(offset, header.headerVersion)
    offset += 4
    outView.setUint32(offset, header.ttcFonts.length)
    offset += 4

    const offsetTableStart = offset
    offset += 4 * header.ttcFonts.length // Space for offset table

    if (header.headerVersion === 0x00020000) {
      // DSIG fields (zeroed)
      offset += 12
    }

    // Write each font's offset table
    for (let i = 0; i < header.ttcFonts.length; i++) {
      const ttcFont = header.ttcFonts[i]
      outView.setUint32(offsetTableStart + i * 4, offset)
      ttcFont.dstOffset = offset

      const numTables = ttcFont.tableIndices.length
      offset = writeOffsetTable(outView, offset, ttcFont.flavor, numTables)

      // Sort table indices by tag for this font
      const sortedIndices = [...ttcFont.tableIndices].sort(
        (a, b) => header.tables[a].tag - header.tables[b].tag
      )

      const tableEntryByTag = new Map<number, number>()
      for (const tableIdx of sortedIndices) {
        const table = header.tables[tableIdx]
        tableEntryByTag.set(table.tag, offset)
        offset = writeTableEntry(outView, offset, table.tag)
      }

      // Update tableIndices to sorted order for later reconstruction
      ttcFont.tableIndices = sortedIndices

      ttcFont.headerChecksum = computeChecksum(
        output,
        ttcFont.dstOffset,
        offset - ttcFont.dstOffset
      )

      fontInfos.push({
        numGlyphs: 0,
        indexFormat: 0,
        numHMetrics: 0,
        xMins: new Int16Array(0),
        tableEntryByTag,
      })
    }
  } else {
    // Single font
    offset = writeOffsetTable(outView, offset, header.flavor, header.numTables)

    // Sort tables by tag for output
    const sortedTables = [...header.tables].sort((a, b) => a.tag - b.tag)
    const tableEntryByTag = new Map<number, number>()

    for (const table of sortedTables) {
      tableEntryByTag.set(table.tag, offset)
      offset = writeTableEntry(outView, offset, table.tag)
    }

    fontInfos.push({
      numGlyphs: 0,
      indexFormat: 0,
      numHMetrics: 0,
      xMins: new Int16Array(0),
      tableEntryByTag,
    })
  }

  return fontInfos
}

function writeOffsetTable(
  view: DataView,
  offset: number,
  flavor: number,
  numTables: number
): number {
  view.setUint32(offset, flavor)
  view.setUint16(offset + 4, numTables)

  let maxPow2 = 0
  while ((1 << (maxPow2 + 1)) <= numTables) {
    maxPow2++
  }
  const searchRange = (1 << maxPow2) * 16

  view.setUint16(offset + 6, searchRange)
  view.setUint16(offset + 8, maxPow2)
  view.setUint16(offset + 10, numTables * 16 - searchRange)

  return offset + SFNT_HEADER_SIZE
}

function writeTableEntry(view: DataView, offset: number, tag: number): number {
  view.setUint32(offset, tag)
  view.setUint32(offset + 4, 0) // checksum placeholder
  view.setUint32(offset + 8, 0) // offset placeholder
  view.setUint32(offset + 12, 0) // length placeholder
  return offset + SFNT_ENTRY_SIZE
}

function reconstructFont(
  decompressed: Uint8Array,
  header: Woff2Header,
  fontIndex: number,
  fontInfo: FontInfo,
  out: Output,
  writtenTables: Map<string, WrittenTable>,
  dstOffset: number
): number {
  const tables =
    header.ttcFonts.length > 0
      ? header.ttcFonts[fontIndex].tableIndices.map((i) => header.tables[i])
      : header.tables

  // Sort tables for processing
  const sortedTables = [...tables].sort((a, b) => a.tag - b.tag)

  // First pass: find glyf/loca and hhea for metadata
  const glyfTable = sortedTables.find((t) => t.tag === TAG_GLYF)
  const locaTable = sortedTables.find((t) => t.tag === TAG_LOCA)
  const hheaTable = sortedTables.find((t) => t.tag === TAG_HHEA)

  if (hheaTable && hheaTable.srcLength >= 36) {
    const p = hheaTable.srcOffset + 34
    fontInfo.numHMetrics = (decompressed[p] << 8) | decompressed[p + 1]
  }

  const isTTC = header.ttcFonts.length > 0

  // TTC: running sum of this font's directory and tables
  // Single font: sum of table checksums, directory added at the end
  let fontChecksum = isTTC ? header.ttcFonts[fontIndex].headerChecksum : 0

  // Records a table already present in the output at dstOffset
  const commit = (table: Table, entryOffset: number, length: number): void => {
    const checksum = computeChecksum(out.data, dstOffset, length)
    updateTableEntry(out.view, entryOffset, checksum, dstOffset, length)
    fontChecksum = (fontChecksum + checksum) >>> 0
    if (isTTC) {
      fontChecksum = (fontChecksum + computeTableEntryChecksum(checksum, dstOffset, length)) >>> 0
    }
    writtenTables.set(table.key, { dstOffset, dstLength: length, checksum })
    table.dstOffset = dstOffset
    table.dstLength = length
    dstOffset += pad4(length)
  }

  // Write each table
  for (const table of sortedTables) {
    const entryOffset = fontInfo.tableEntryByTag.get(table.tag)
    if (entryOffset === undefined) continue

    // Check if this table was already written (TTC table sharing)
    const existing = writtenTables.get(table.key)
    if (existing) {
      updateTableEntry(out.view, entryOffset, existing.checksum, existing.dstOffset, existing.dstLength)
      if (isTTC) {
        fontChecksum = (fontChecksum + existing.checksum) >>> 0
        fontChecksum = (fontChecksum + computeTableEntryChecksum(existing.checksum, existing.dstOffset, existing.dstLength)) >>> 0
      }
      continue
    }

    let tableData: Uint8Array

    if ((table.flags & WOFF2_FLAGS_TRANSFORM) !== 0) {
      if (table.tag === TAG_GLYF && glyfTable && locaTable) {
        // glyf is rebuilt in place to avoid a second copy of the largest table
        const result = reconstructGlyf(
          decompressed,
          glyfTable.srcOffset,
          glyfTable.transformLength,
          out.data,
          dstOffset
        )
        if (result.out !== out.data) {
          out.data = result.out
          out.view = new DataView(result.out.buffer)
        }
        fontInfo.numGlyphs = result.numGlyphs
        fontInfo.indexFormat = result.indexFormat
        fontInfo.xMins = result.xMins

        commit(glyfTable, entryOffset, result.glyfLength)

        const locaEntryOffset = fontInfo.tableEntryByTag.get(TAG_LOCA)
        if (locaEntryOffset !== undefined) {
          ensureOutput(out, dstOffset + pad4(result.locaData.byteLength))
          out.data.set(result.locaData, dstOffset)
          commit(locaTable, locaEntryOffset, result.locaData.byteLength)
        }
        continue
      } else if (table.tag === TAG_LOCA) {
        // Already handled with glyf
        continue
      } else if (table.tag === TAG_HMTX) {
        tableData = reconstructHmtx(
          decompressed,
          table.srcOffset,
          table.srcLength,
          fontInfo.numGlyphs,
          fontInfo.numHMetrics,
          fontInfo.xMins
        )
      } else {
        throw new Error(`Unknown transform for table ${tagToString(table.tag)}`)
      }
    } else {
      // No transform, copy directly
      tableData = decompressed.subarray(
        table.srcOffset,
        table.srcOffset + table.srcLength
      )
    }

    ensureOutput(out, dstOffset + pad4(tableData.byteLength))
    out.data.set(tableData, dstOffset)

    // checkSumAdjustment must be zero while checksums are computed
    if (table.tag === TAG_HEAD && tableData.byteLength >= 12) {
      out.view.setUint32(dstOffset + 8, 0)
    }

    commit(table, entryOffset, tableData.byteLength)
  }

  // Update head checkSumAdjustment
  const headTable = sortedTables.find((t) => t.tag === TAG_HEAD)
  if (headTable) {
    const headEntry = writtenTables.get(headTable.key)
    if (headEntry && headEntry.dstLength >= 12) {
      // Tables are 4-byte aligned and zero padded, so the whole-file sum is
      // the directory sum plus the table sums, no second pass over the output
      const finalChecksum = isTTC
        ? fontChecksum
        : (computeChecksum(out.data, 0, SFNT_HEADER_SIZE + SFNT_ENTRY_SIZE * header.numTables) +
            fontChecksum) >>> 0
      out.view.setUint32(headEntry.dstOffset + 8, (0xb1b0afba - finalChecksum) >>> 0)
    }
  }

  return dstOffset
}

function computeTableEntryChecksum(checksum: number, offset: number, length: number): number {
  return (checksum + offset + length) >>> 0
}

function updateTableEntry(
  view: DataView,
  entryOffset: number,
  checksum: number,
  offset: number,
  length: number
): void {
  view.setUint32(entryOffset + 4, checksum)
  view.setUint32(entryOffset + 8, offset)
  view.setUint32(entryOffset + 12, length)
}
