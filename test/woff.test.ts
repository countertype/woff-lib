import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { woffEncode } from '../src/woff/encode'
import { woffDecode } from '../src/woff/decode'

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

describe('woff encode - round-trip', () => {
  it('round-trips TTF through WOFF', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const encoded = await woffEncode(original)
    const decoded = await woffDecode(encoded)
    
    // Check signature
    const view = new DataView(encoded.buffer, encoded.byteOffset)
    expect(view.getUint32(0)).toBe(0x774f4646) // 'wOFF'
    
    // Same number of glyphs
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
    
    // Same tables
    const origTables = parseTableDirectory(original)
    const decodedTables = parseTableDirectory(decoded)
    expect(decodedTables.size).toBe(origTables.size)
  })

  it('round-trips OTF/CFF through WOFF', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    
    const encoded = await woffEncode(original)
    const decoded = await woffDecode(encoded)
    
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })

  it('round-trips variable TTF through WOFF', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))
    
    const encoded = await woffEncode(original)
    const decoded = await woffDecode(encoded)
    
    expect(getNumGlyphs(decoded)).toBe(getNumGlyphs(original))
  })
})

describe('woff encode - compression', () => {
  it('compresses TTF smaller than original', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    const encoded = await woffEncode(original)
    
    const ratio = encoded.byteLength / original.byteLength
    console.log(`WOFF TTF compression: ${original.byteLength} → ${encoded.byteLength} (${(ratio * 100).toFixed(1)}%)`)
    
    expect(ratio).toBeLessThan(1)
  })

  it('compresses OTF smaller than original', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    const encoded = await woffEncode(original)
    
    const ratio = encoded.byteLength / original.byteLength
    console.log(`WOFF OTF compression: ${original.byteLength} → ${encoded.byteLength} (${(ratio * 100).toFixed(1)}%)`)
    
    expect(ratio).toBeLessThan(1)
  })
})
