import { bench, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { woff2Decode } from '../src/woff2/decode/decode'

const fixturesPath = join(__dirname, '../test/fixtures')

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

const files = [
  { label: 'TTF', file: 'enc-ttf.woff2' },
  { label: 'CFF/OTF', file: 'enc-otf.woff2' },
  { label: 'Variable TTF', file: 'enc-var-ttf.woff2' },
] as const

const fixtures = files.map((f) => {
  const input = readFileSync(join(fixturesPath, f.file))
  return { label: f.label, input }
})

const outputSizes = await Promise.all(
  fixtures.map(async (f) => (await woff2Decode(f.input)).byteLength)
)

console.log('\n[bench] woff2Decode:')
for (let i = 0; i < fixtures.length; i++) {
  const f = fixtures[i]
  console.log(
    `  ${f.label}: ${sizeLabel(f.input.byteLength)} → ${sizeLabel(outputSizes[i])}`
  )
}

describe('woff2Decode', () => {
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]
    const outSize = outputSizes[i]
    bench(`${f.label} (${sizeLabel(f.input.byteLength)} → ${sizeLabel(outSize)})`, async () => {
      await woff2Decode(f.input)
    })
  }
})
