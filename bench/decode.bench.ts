import { beforeAll, bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woff2Decode } from '../src/woff2/decode/decode'

const fixturesPath = join(__dirname, '../test/fixtures')

let encTtfInput: Uint8Array
let encOtfInput: Uint8Array
let encVarTtfInput: Uint8Array

beforeAll(() => {
  encTtfInput = readFileSync(join(fixturesPath, 'enc-ttf.woff2'))
  encOtfInput = readFileSync(join(fixturesPath, 'enc-otf.woff2'))
  encVarTtfInput = readFileSync(join(fixturesPath, 'enc-var-ttf.woff2'))

  console.log(`\n[bench] Input sizes:`)
  console.log(`  enc-ttf.woff2: ${(encTtfInput.byteLength / 1024).toFixed(1)} KB`)
  console.log(`  enc-otf.woff2: ${(encOtfInput.byteLength / 1024).toFixed(1)} KB`)
  console.log(`  enc-var-ttf.woff2: ${(encVarTtfInput.byteLength / 1024).toFixed(1)} KB`)
})

describe('woff2Decode', () => {
  bench('enc-ttf.woff2 (TTF)', async () => {
    await woff2Decode(encTtfInput)
  })

  bench('enc-otf.woff2 (CFF/OTF)', async () => {
    await woff2Decode(encOtfInput)
  })

  bench('enc-var-ttf.woff2 (Variable TTF)', async () => {
    await woff2Decode(encVarTtfInput)
  })
})
