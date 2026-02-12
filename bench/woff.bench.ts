import { bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woffEncode } from '../src/woff/encode'
import { woffDecode } from '../src/woff/decode'

const fixturesPath = join(__dirname, '../test/fixtures')

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

const files = [
  { label: 'TTF', file: 'dec-enc-ttf.ttf' },
  { label: 'CFF/OTF', file: 'dec-enc-otf.otf' },
  { label: 'Variable TTF', file: 'dec-enc-var-ttf.ttf' },
] as const

// Pre-encode/decode at module level
const encodeFixtures: Array<{ label: string; input: Uint8Array; outputSize: number }> = []
const decodeFixtures: Array<{ label: string; input: Uint8Array; outputSize: number }> = []

for (const f of files) {
  const input = readFileSync(join(fixturesPath, f.file))
  const woff = await woffEncode(input)
  const decoded = await woffDecode(woff)

  encodeFixtures.push({ label: f.label, input, outputSize: woff.byteLength })
  decodeFixtures.push({ label: f.label, input: woff, outputSize: decoded.byteLength })
}

console.log('\n[bench] woffEncode:')
for (const f of encodeFixtures) {
  console.log(
    `  ${f.label}: ${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.outputSize)}`
  )
}
console.log('[bench] woffDecode:')
for (const f of decodeFixtures) {
  console.log(
    `  ${f.label}: ${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.outputSize)}`
  )
}

describe('woffEncode', () => {
  for (const f of encodeFixtures) {
    bench(`${f.label} (${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.outputSize)})`, async () => {
      await woffEncode(f.input)
    })
  }
})

describe('woffDecode', () => {
  for (const f of decodeFixtures) {
    bench(`${f.label} (${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.outputSize)})`, async () => {
      await woffDecode(f.input)
    })
  }
})
