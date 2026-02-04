// WOFF2 encoder
// https://www.w3.org/TR/WOFF2/

import { brotliEncode, EncoderMode } from 'brotli-lib/encode'
import { WriteBuffer } from './write-buffer'
import {
  parseSfnt,
  isCff,
  getGlyphInfo,
  getNumHMetrics,
} from './sfnt'
import { transformGlyf } from './transform-glyf'
import { transformHmtx } from './transform-hmtx'
import {
  TAG_GLYF,
  TAG_LOCA,
  TAG_HEAD,
  TAG_HMTX,
  TAG_DSIG,
  WOFF2_SIGNATURE,
  getKnownTagIndex,
} from '../../shared/known-tags'
import { sizeBase128 } from '../../shared/variable-length'

export interface Woff2EncodeOptions {
  quality?: number // 0-11, default 11
}

// SFNT constants
const SFNT_HEADER_SIZE = 12
const SFNT_ENTRY_SIZE = 16

// head table bit 11 flag (must be set per WOFF2 spec)
const HEAD_FLAG_BIT_11 = 1 << 11

interface TableInfo {
  tag: number
  origLength: number
  transformLength: number
  transformVersion: number
  data: Uint8Array
}

// Encode TTF/OTF to WOFF2 format
export function woff2Encode(
  data: ArrayBuffer | Uint8Array,
  options?: Woff2EncodeOptions
): Uint8Array {
  const input = data instanceof Uint8Array ? data : new Uint8Array(data)
  const quality = options?.quality ?? 11

  // Parse SFNT
  const font = parseSfnt(input)
  const hasCff = isCff(font)

  // Build table list sorted by tag, excluding DSIG (must be removed per spec)
  const sortedTags = [...font.tables.keys()]
    .filter(tag => tag !== TAG_DSIG)
    .sort((a, b) => a - b)

  // Process tables
  const tableInfos: TableInfo[] = []
  let transformedGlyfData: Uint8Array | null = null
  let glyfOrigLength = 0
  let transformedHmtxData: Uint8Array | null = null
  let hmtxOrigLength = 0

  // Transform glyf/loca for TrueType fonts
  if (!hasCff && font.tables.has(TAG_GLYF) && font.tables.has(TAG_LOCA)) {
    const glyphInfo = getGlyphInfo(font)
    const transformed = transformGlyf(font, glyphInfo)
    transformedGlyfData = transformed.data
    glyfOrigLength = transformed.origLength

    // Transform hmtx if glyf is present (LSB optimization)
    if (font.tables.has(TAG_HMTX)) {
      const hmtxEntry = font.tables.get(TAG_HMTX)!
      const numHMetrics = getNumHMetrics(font)
      const hmtxData = input.subarray(hmtxEntry.offset, hmtxEntry.offset + hmtxEntry.length)
      const transformed = transformHmtx(font, hmtxData, numHMetrics, glyphInfo)
      if (transformed) {
        transformedHmtxData = transformed.data
        hmtxOrigLength = hmtxEntry.length
      }
    }
  }

  // Build table info array
  for (const tag of sortedTags) {
    const entry = font.tables.get(tag)!

    if (tag === TAG_GLYF && transformedGlyfData) {
      // Transformed glyf (transform version 0)
      tableInfos.push({
        tag,
        origLength: glyfOrigLength,
        transformLength: transformedGlyfData.byteLength,
        transformVersion: 0,
        data: transformedGlyfData,
      })
    } else if (tag === TAG_LOCA && transformedGlyfData) {
      // Transformed loca (becomes empty - reconstructed from glyf)
      const locaEntry = font.tables.get(TAG_LOCA)!
      tableInfos.push({
        tag,
        origLength: locaEntry.length,
        transformLength: 0,
        transformVersion: 0,
        data: new Uint8Array(0),
      })
    } else if (tag === TAG_HMTX && transformedHmtxData) {
      // Transformed hmtx (transform version 1)
      tableInfos.push({
        tag,
        origLength: hmtxOrigLength,
        transformLength: transformedHmtxData.byteLength,
        transformVersion: 1,
        data: transformedHmtxData,
      })
    } else if (tag === TAG_HEAD) {
      // head table: set bit 11 as required by spec
      const tableData = new Uint8Array(entry.length)
      tableData.set(input.subarray(entry.offset, entry.offset + entry.length))
      
      // Set bit 11 in flags field (offset 16-17)
      const view = new DataView(tableData.buffer)
      const flags = view.getUint16(16)
      view.setUint16(16, flags | HEAD_FLAG_BIT_11)
      
      tableInfos.push({
        tag,
        origLength: entry.length,
        transformLength: entry.length,
        transformVersion: 0, // No transform for head
        data: tableData,
      })
    } else {
      // Untransformed table
      const tableData = input.subarray(entry.offset, entry.offset + entry.length)
      tableInfos.push({
        tag,
        origLength: entry.length,
        transformLength: entry.length,
        transformVersion: 0, // transform version 0 = no transform for non-glyf/loca
        data: tableData,
      })
    }
  }

  // Concatenate all table data for compression
  let totalTransformSize = 0
  for (const info of tableInfos) {
    totalTransformSize += info.data.byteLength
  }

  const tableDataStream = new Uint8Array(totalTransformSize)
  let streamOffset = 0
  for (const info of tableInfos) {
    tableDataStream.set(info.data, streamOffset)
    streamOffset += info.data.byteLength
  }

  // Compress with Brotli using FONT mode
  const compressed = brotliEncode(tableDataStream, {
    quality,
    mode: EncoderMode.FONT,
  })

  // Calculate total original SFNT size
  let totalSfntSize = SFNT_HEADER_SIZE + tableInfos.length * SFNT_ENTRY_SIZE
  for (const info of tableInfos) {
    totalSfntSize += (info.origLength + 3) & ~3 // padded
  }

  // Calculate table directory size
  let tableDirectorySize = 0
  for (const info of tableInfos) {
    const tagIndex = getKnownTagIndex(info.tag)
    tableDirectorySize += 1 // flags byte
    if (tagIndex === 63) {
      tableDirectorySize += 4 // arbitrary tag
    }
    tableDirectorySize += sizeBase128(info.origLength)
    
    // transformLength is written for glyf/loca when transformed (version 0)
    // and for hmtx when transformed (version 1)
    const needsTransformLength = 
      ((info.tag === TAG_GLYF || info.tag === TAG_LOCA) && info.transformVersion === 0) ||
      (info.tag === TAG_HMTX && info.transformVersion === 1)
    
    if (needsTransformLength) {
      tableDirectorySize += sizeBase128(info.transformLength)
    }
  }

  // Build WOFF2 output
  const woff2HeaderSize = 48
  const totalSize = woff2HeaderSize + tableDirectorySize + compressed.byteLength
  const output = new WriteBuffer(totalSize)

  // Write WOFF2 header
  output.writeU32(WOFF2_SIGNATURE) // signature 'wOF2'
  output.writeU32(font.flavor) // flavor (original SFNT signature)
  output.writeU32(totalSize) // length
  output.writeU16(tableInfos.length) // numTables
  output.writeU16(0) // reserved
  output.writeU32(totalSfntSize) // totalSfntSize
  output.writeU32(compressed.byteLength) // totalCompressedSize
  output.writeU16(1) // majorVersion
  output.writeU16(0) // minorVersion
  output.writeU32(0) // metaOffset
  output.writeU32(0) // metaLength
  output.writeU32(0) // metaOrigLength
  output.writeU32(0) // privOffset
  output.writeU32(0) // privLength

  // Write table directory
  for (const info of tableInfos) {
    const tagIndex = getKnownTagIndex(info.tag)

    // Flags byte: transform bits (6-7) + tag index (0-5)
    // Transform version encoding:
    //   00 = version 0 (transformed for glyf/loca, not transformed for others)
    //   01 = version 1 (transformed hmtx)
    //   10 = version 2
    //   11 = version 3 (not transformed for glyf/loca)
    let flags = tagIndex & 0x3f

    if (info.tag === TAG_GLYF || info.tag === TAG_LOCA) {
      // glyf/loca: version 0 = transformed, version 3 = not transformed
      if (info.transformVersion === 3) {
        flags |= 0xc0
      }
      // version 0 = no extra bits
    } else if (info.tag === TAG_HMTX) {
      // hmtx: version 0 = not transformed, version 1 = transformed
      if (info.transformVersion === 1) {
        flags |= 0x40 // version 1
      }
    }
    // Other tables: transform version is always 0 (not transformed)

    output.writeU8(flags)

    if (tagIndex === 63) {
      output.writeU32(info.tag)
    }

    output.writeBase128(info.origLength)

    // Write transformLength for transformed tables
    const needsTransformLength = 
      ((info.tag === TAG_GLYF || info.tag === TAG_LOCA) && info.transformVersion === 0) ||
      (info.tag === TAG_HMTX && info.transformVersion === 1)
    
    if (needsTransformLength) {
      output.writeBase128(info.transformLength)
    }
  }

  // Write compressed data
  output.writeBytes(compressed)

  return output.getBytes()
}
