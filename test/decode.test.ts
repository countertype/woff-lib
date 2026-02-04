import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { woff2Decode } from '../src/woff2/decode/decode'

const fixturesPath = join(__dirname, 'fixtures')

describe('decode - real world fonts', () => {
  it('decodes og.woff2 to TTF', async () => {
    const input = readFileSync(join(fixturesPath, 'og.woff2'))
    const expected = readFileSync(join(fixturesPath, 'dec-woff2.ttf'))
    
    const result = await woff2Decode(input)
    
    expect(Buffer.from(result).equals(expected)).toBe(true)
  })

  it('decodes enc-ttf.woff2 to TTF', async () => {
    const input = readFileSync(join(fixturesPath, 'enc-ttf.woff2'))
    const expected = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
    
    const result = await woff2Decode(input)
    
    expect(Buffer.from(result).equals(expected)).toBe(true)
  })

  it('decodes enc-otf.woff2 to OTF (CFF)', async () => {
    const input = readFileSync(join(fixturesPath, 'enc-otf.woff2'))
    const expected = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
    
    const result = await woff2Decode(input)
    
    expect(Buffer.from(result).equals(expected)).toBe(true)
  })

  it('decodes enc-var-ttf.woff2 to variable TTF', async () => {
    const input = readFileSync(join(fixturesPath, 'enc-var-ttf.woff2'))
    const expected = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))
    
    const result = await woff2Decode(input)
    
    expect(Buffer.from(result).equals(expected)).toBe(true)
  })
})
