import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { woffEncode } from '../src/woff/encode'
import { woff2Encode } from '../src/woff2/encode/encode'

const fixturesPath = join(__dirname, 'fixtures')

describe('WOFF vs WOFF2 compression comparison', () => {
  it('compares TTF compression', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const woff = await woffEncode(original)
    const woff2 = woff2Encode(original)
    
    const woffRatio = woff.byteLength / original.byteLength
    const woff2Ratio = woff2.byteLength / original.byteLength
    
    console.log(`\nTTF (${(original.byteLength / 1024).toFixed(1)} KB):`)
    console.log(`  WOFF:  ${woff.byteLength} bytes (${(woffRatio * 100).toFixed(1)}%)`)
    console.log(`  WOFF2: ${woff2.byteLength} bytes (${(woff2Ratio * 100).toFixed(1)}%)`)
    console.log(`  WOFF2 is ${((1 - woff2Ratio / woffRatio) * 100).toFixed(1)}% smaller than WOFF`)
    
    // WOFF2 should be better for TTF due to glyf transforms
    expect(woff2.byteLength).toBeLessThan(woff.byteLength)
  })

  it('compares OTF/CFF compression', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    
    const woff = await woffEncode(original)
    const woff2 = woff2Encode(original)
    
    const woffRatio = woff.byteLength / original.byteLength
    const woff2Ratio = woff2.byteLength / original.byteLength
    
    console.log(`\nOTF/CFF (${(original.byteLength / 1024).toFixed(1)} KB):`)
    console.log(`  WOFF:  ${woff.byteLength} bytes (${(woffRatio * 100).toFixed(1)}%)`)
    console.log(`  WOFF2: ${woff2.byteLength} bytes (${(woff2Ratio * 100).toFixed(1)}%)`)
    
    const diff = ((woff2Ratio / woffRatio - 1) * 100)
    if (diff > 0) {
      console.log(`  WOFF2 is ${diff.toFixed(1)}% larger than WOFF (no glyf transform for CFF)`)
    } else {
      console.log(`  WOFF2 is ${(-diff).toFixed(1)}% smaller than WOFF`)
    }
  })

  it('compares Variable TTF compression', async () => {
    const original = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))
    
    const woff = await woffEncode(original)
    const woff2 = woff2Encode(original)
    
    const woffRatio = woff.byteLength / original.byteLength
    const woff2Ratio = woff2.byteLength / original.byteLength
    
    console.log(`\nVariable TTF (${(original.byteLength / 1024).toFixed(1)} KB):`)
    console.log(`  WOFF:  ${woff.byteLength} bytes (${(woffRatio * 100).toFixed(1)}%)`)
    console.log(`  WOFF2: ${woff2.byteLength} bytes (${(woff2Ratio * 100).toFixed(1)}%)`)
    console.log(`  WOFF2 is ${((1 - woff2Ratio / woffRatio) * 100).toFixed(1)}% smaller than WOFF`)
    
    expect(woff2.byteLength).toBeLessThan(woff.byteLength)
  })
})
