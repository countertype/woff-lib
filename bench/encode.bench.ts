import { bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woff2Encode } from '../src/woff2/encode/encode'

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

const fixtures = files.map((f) => {
  const input = readFileSync(join(fixturesPath, f.file))
  // Pre-encode once per quality to get output sizes
  const q11Size = woff2Encode(input).byteLength
  const q4Size = woff2Encode(input, { quality: 4 }).byteLength
  return { label: f.label, input, q11Size, q4Size }
})

console.log('\n[bench] woff2Encode:')
for (const f of fixtures) {
  console.log(
    `  ${f.label}: ${sizeLabel(f.input.byteLength)} → q11: ${sizeLabel(f.q11Size)}, q4: ${sizeLabel(f.q4Size)}`
  )
}

describe('woff2Encode quality 11', () => {
  for (const f of fixtures) {
    bench(`${f.label} (${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.q11Size)})`, () => {
      woff2Encode(f.input)
    })
  }
})

describe('woff2Encode quality 4', () => {
  for (const f of fixtures) {
    bench(`${f.label} (${sizeLabel(f.input.byteLength)} → ${sizeLabel(f.q4Size)})`, () => {
      woff2Encode(f.input, { quality: 4 })
    })
  }
})
