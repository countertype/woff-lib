import { beforeAll, bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woff2Encode } from '../src/woff2/encode/encode'

const fixturesPath = join(__dirname, '../test/fixtures')

let ttfInput: Uint8Array
let otfInput: Uint8Array
let varTtfInput: Uint8Array

beforeAll(() => {
  ttfInput = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
  otfInput = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
  varTtfInput = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))

  console.log(`\n[bench] Input sizes:`)
  console.log(`  dec-enc-ttf.ttf: ${(ttfInput.byteLength / 1024).toFixed(1)} KB`)
  console.log(`  dec-enc-otf.otf: ${(otfInput.byteLength / 1024).toFixed(1)} KB`)
  console.log(`  dec-enc-var-ttf.ttf: ${(varTtfInput.byteLength / 1024).toFixed(1)} KB`)
})

describe('woff2Encode quality 11', () => {
  bench('TTF', () => {
    woff2Encode(ttfInput)
  })

  bench('OTF/CFF', () => {
    woff2Encode(otfInput)
  })

  bench('Variable TTF', () => {
    woff2Encode(varTtfInput)
  })
})

describe('woff2Encode quality 4', () => {
  bench('TTF', () => {
    woff2Encode(ttfInput, { quality: 4 })
  })

  bench('OTF/CFF', () => {
    woff2Encode(otfInput, { quality: 4 })
  })

  bench('Variable TTF', () => {
    woff2Encode(varTtfInput, { quality: 4 })
  })
})
