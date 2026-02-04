import { beforeAll, bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woffEncode } from '../src/woff/encode'
import { woffDecode } from '../src/woff/decode'

const fixturesPath = join(__dirname, '../test/fixtures')

let ttfInput: Uint8Array
let otfInput: Uint8Array
let varTtfInput: Uint8Array
let woffTtf: Uint8Array
let woffOtf: Uint8Array
let woffVar: Uint8Array

beforeAll(async () => {
  ttfInput = readFileSync(join(fixturesPath, 'dec-enc-ttf.ttf'))
  otfInput = readFileSync(join(fixturesPath, 'dec-enc-otf.otf'))
  varTtfInput = readFileSync(join(fixturesPath, 'dec-enc-var-ttf.ttf'))

  // Pre-encode for decode benchmarks
  woffTtf = await woffEncode(ttfInput)
  woffOtf = await woffEncode(otfInput)
  woffVar = await woffEncode(varTtfInput)

  console.log(`\n[bench] Input sizes:`)
  console.log(`  TTF: ${(ttfInput.byteLength / 1024).toFixed(1)} KB → ${(woffTtf.byteLength / 1024).toFixed(1)} KB WOFF`)
  console.log(`  OTF: ${(otfInput.byteLength / 1024).toFixed(1)} KB → ${(woffOtf.byteLength / 1024).toFixed(1)} KB WOFF`)
  console.log(`  Var: ${(varTtfInput.byteLength / 1024).toFixed(1)} KB → ${(woffVar.byteLength / 1024).toFixed(1)} KB WOFF`)
})

describe('woffEncode', () => {
  bench('TTF', async () => {
    await woffEncode(ttfInput)
  })

  bench('OTF/CFF', async () => {
    await woffEncode(otfInput)
  })

  bench('Variable TTF', async () => {
    await woffEncode(varTtfInput)
  })
})

describe('woffDecode', () => {
  bench('TTF', async () => {
    await woffDecode(woffTtf)
  })

  bench('OTF/CFF', async () => {
    await woffDecode(woffOtf)
  })

  bench('Variable TTF', async () => {
    await woffDecode(woffVar)
  })
})
