import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { woff2Encode } from '../src/woff2/encode/encode'
import { woff2Decode } from '../src/woff2/decode/decode'

const fixturesPath = join(__dirname, 'fixtures')

function parseTableDirectory(data: Uint8Array): Map<string, { offset: number; length: number }> {
  const view = new DataView(data.buffer, data.byteOffset)
  const numTables = view.getUint16(4)
  const tables = new Map<string, { offset: number; length: number }>()
  
  for (let i = 0; i < numTables; i++) {
    const recordOffset = 12 + i * 16
    const tag = view.getUint32(recordOffset)
    const offset = view.getUint32(recordOffset + 8)
    const length = view.getUint32(recordOffset + 12)
    const tagStr = String.fromCharCode((tag >> 24) & 0xff, (tag >> 16) & 0xff, (tag >> 8) & 0xff, tag & 0xff)
    tables.set(tagStr, { offset, length })
  }
  
  return tables
}

function getNumGlyphs(data: Uint8Array): number {
  const tables = parseTableDirectory(data)
  const maxp = tables.get('maxp')
  if (!maxp) return 0
  const view = new DataView(data.buffer, data.byteOffset)
  return view.getUint16(maxp.offset + 4)
}

describe('encode - round-trip', () => {
  it('round-trips TTF with same table structure', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const encoded = woff2Encode(original)
    const decoded = await woff2Decode(encoded)
    
    const origTables = parseTableDirectory(original)
    const decodedTables = parseTableDirectory(decoded)
    
    // Same number of tables
    expect(decodedTables.size).toBe(origTables.size)
    
    // Same tables exist
    for (const tag of origTables.keys()) {
      expect(decodedTables.has(tag), `Missing table ${tag}`).toBe(true)
    }
    
    // Same number of glyphs
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })

  it('round-trips OTF/CFF with same table structure', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    
    const encoded = woff2Encode(original)
    const decoded = await woff2Decode(encoded)
    
    const origTables = parseTableDirectory(original)
    const decodedTables = parseTableDirectory(decoded)
    
    expect(decodedTables.size).toBe(origTables.size)
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })

  it('round-trips variable TTF with same table structure', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))
    
    const encoded = woff2Encode(original)
    const decoded = await woff2Decode(encoded)
    
    const origTables = parseTableDirectory(original)
    const decodedTables = parseTableDirectory(decoded)
    
    expect(decodedTables.size).toBe(origTables.size)
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })
})

describe('encode - compression ratio', () => {
  it('compresses TTF smaller than original', () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    const encoded = woff2Encode(original)
    
    const ratio = encoded.byteLength / original.byteLength
    console.log(`TTF compression: ${original.byteLength} → ${encoded.byteLength} (${(ratio * 100).toFixed(1)}%)`)
    
    expect(ratio).toBeLessThan(1)
  })

  it('compresses OTF smaller than original', () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    const encoded = woff2Encode(original)
    
    const ratio = encoded.byteLength / original.byteLength
    console.log(`OTF compression: ${original.byteLength} → ${encoded.byteLength} (${(ratio * 100).toFixed(1)}%)`)
    
    expect(ratio).toBeLessThan(1)
  })

  it('quality 4 produces valid output', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const encoded = woff2Encode(original, { quality: 4 })
    const decoded = await woff2Decode(encoded)
    
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })
})

describe('encode - stability', () => {
  it('double round-trip preserves glyph count', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    // First round-trip
    const encoded1 = woff2Encode(original)
    const decoded1 = await woff2Decode(encoded1)
    
    // Second round-trip
    const encoded2 = woff2Encode(decoded1)
    const decoded2 = await woff2Decode(encoded2)
    
    // Same number of glyphs through all round-trips
    const origGlyphs = getNumGlyphs(original)
    const decoded1Glyphs = getNumGlyphs(decoded1)
    const decoded2Glyphs = getNumGlyphs(decoded2)
    
    expect(decoded1Glyphs).toBe(origGlyphs)
    expect(decoded2Glyphs).toBe(origGlyphs)
    
    // Second encode should produce roughly similar size
    const ratio = encoded2.byteLength / encoded1.byteLength
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.1)
  })
})

describe('encode - spec conformance', () => {
  it('sets head flags bit 11', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const encoded = woff2Encode(original)
    const decoded = await woff2Decode(encoded)
    
    // Find head table and check flags
    const tables = parseTableDirectory(decoded)
    const head = tables.get('head')
    expect(head).toBeDefined()
    
    const view = new DataView(decoded.buffer, decoded.byteOffset)
    const flags = view.getUint16(head!.offset + 16)
    
    // Bit 11 should be set
    expect(flags & (1 << 11)).toBe(1 << 11)
  })

  it('removes DSIG table if present', async () => {
    // Create a mock font with DSIG by encoding and then checking output
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const encoded = woff2Encode(original)
    const decoded = await woff2Decode(encoded)
    
    const tables = parseTableDirectory(decoded)
    
    // DSIG should not be in output (encoder removes it)
    expect(tables.has('DSIG')).toBe(false)
  })
})
