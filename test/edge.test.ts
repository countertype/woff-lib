import { describe, it, expect } from 'vitest'
import { woff2Encode } from '../src/woff2/encode/encode'
import { woff2Decode } from '../src/woff2/decode/decode'

// One contour, alternating on/off curve so flags cannot be run-length packed
function simpleGlyph(nPoints: number): Uint8Array {
  const g = new Uint8Array(10 + 2 + 2 + nPoints * 3)
  const v = new DataView(g.buffer)
  let x = 0
  let y = 0
  for (let i = 0; i < nPoints; i++) {
    const dx = 1 + (i % 7)
    const dy = 1 + (i % 5)
    g[14 + i] = i & 1 ? 0x36 : 0x37
    g[14 + nPoints + i] = dx
    g[14 + 2 * nPoints + i] = dy
    x += dx
    y += dy
  }
  v.setInt16(0, 1)
  v.setInt16(2, 1)
  v.setInt16(4, 1)
  v.setInt16(6, x)
  v.setInt16(8, y)
  v.setUint16(10, nPoints - 1)
  v.setUint16(12, 0)
  return g
}

interface Metric {
  advance: number
  lsb: number
}

function buildFont(glyphs: Uint8Array[], align: number, metrics?: Metric[]): Uint8Array {
  const offsets = [0]
  let glyfLength = 0
  for (const g of glyphs) {
    glyfLength += Math.ceil(g.byteLength / align) * align
    offsets.push(glyfLength)
  }
  const glyf = new Uint8Array(glyfLength)
  glyphs.forEach((g, i) => glyf.set(g, offsets[i]))

  const loca = new Uint8Array(offsets.length * 4)
  const locaView = new DataView(loca.buffer)
  offsets.forEach((off, i) => locaView.setUint32(i * 4, off))

  const head = new Uint8Array(54)
  const headView = new DataView(head.buffer)
  headView.setUint32(0, 0x00010000)
  headView.setUint32(12, 0x5f0f3cf5)
  headView.setUint16(18, 1000)
  headView.setInt16(50, 1) // long loca

  const maxp = new Uint8Array(6)
  const maxpView = new DataView(maxp.buffer)
  maxpView.setUint32(0, 0x00005000)
  maxpView.setUint16(4, glyphs.length)

  const tables: [string, Uint8Array][] = [['glyf', glyf], ['head', head]]
  if (metrics) {
    const hhea = new Uint8Array(36)
    new DataView(hhea.buffer).setUint16(34, metrics.length)
    const hmtx = new Uint8Array(metrics.length * 4)
    const hmtxView = new DataView(hmtx.buffer)
    metrics.forEach((m, i) => {
      hmtxView.setUint16(i * 4, m.advance)
      hmtxView.setInt16(i * 4 + 2, m.lsb)
    })
    tables.push(['hhea', hhea], ['hmtx', hmtx])
  }
  tables.push(['loca', loca], ['maxp', maxp])

  let size = 12 + 16 * tables.length
  for (const [, t] of tables) size += (t.byteLength + 3) & ~3
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tables.length)
  let pos = 12 + 16 * tables.length
  tables.forEach(([tag, t], i) => {
    const entry = 12 + i * 16
    for (let k = 0; k < 4; k++) out[entry + k] = tag.charCodeAt(k)
    view.setUint32(entry + 8, pos)
    view.setUint32(entry + 12, t.byteLength)
    out.set(t, pos)
    pos += (t.byteLength + 3) & ~3
  })
  return out
}

function getTable(font: Uint8Array, tag: string): Uint8Array {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const numTables = view.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16
    const name = String.fromCharCode(font[entry], font[entry + 1], font[entry + 2], font[entry + 3])
    if (name === tag) {
      const offset = view.getUint32(entry + 8)
      return font.subarray(offset, offset + view.getUint32(entry + 12))
    }
  }
  throw new Error(`Missing table ${tag}`)
}

// Expand each glyph to its points so differently packed glyf tables compare equal
function outlines(font: Uint8Array): string[] {
  const glyf = getTable(font, 'glyf')
  const loca = getTable(font, 'loca')
  const locaView = new DataView(loca.buffer, loca.byteOffset, loca.byteLength)
  const numGlyphs = loca.byteLength / 4 - 1
  const result: string[] = []

  for (let g = 0; g < numGlyphs; g++) {
    const start = locaView.getUint32(g * 4)
    const end = locaView.getUint32(g * 4 + 4)
    const view = new DataView(glyf.buffer, glyf.byteOffset + start, end - start)
    if (end === start || view.getInt16(0) === 0) {
      result.push('empty')
      continue
    }

    const nContours = view.getInt16(0)
    let p = 10
    const ends: number[] = []
    for (let i = 0; i < nContours; i++, p += 2) ends.push(view.getUint16(p))
    const numPoints = ends[nContours - 1] + 1
    p += 2 + view.getUint16(p)

    const flags: number[] = []
    while (flags.length < numPoints) {
      const flag = view.getUint8(p++)
      flags.push(flag)
      if (flag & 0x08) {
        for (let r = view.getUint8(p++); r > 0; r--) flags.push(flag)
      }
    }

    const xs: number[] = []
    let x = 0
    for (const flag of flags) {
      if (flag & 0x02) {
        const d = view.getUint8(p++)
        x += flag & 0x10 ? d : -d
      } else if (!(flag & 0x10)) {
        x += view.getInt16(p)
        p += 2
      }
      xs.push(x)
    }

    const points: string[] = []
    let y = 0
    flags.forEach((flag, i) => {
      if (flag & 0x04) {
        const d = view.getUint8(p++)
        y += flag & 0x20 ? d : -d
      } else if (!(flag & 0x20)) {
        y += view.getInt16(p)
        p += 2
      }
      points.push(`${xs[i]},${y},${flag & 1}`)
    })
    result.push(`${ends.join(',')}|${points.join(' ')}`)
  }
  return result
}

async function roundTrip(font: Uint8Array): Promise<Uint8Array> {
  return woff2Decode(woff2Encode(font, { quality: 2 }))
}

describe('glyf edge cases', () => {
  it('round-trips a font averaging far more than 100 points per glyph', async () => {
    const font = buildFont([new Uint8Array(0), simpleGlyph(600)], 4)
    const decoded = await roundTrip(font)
    expect(outlines(decoded)).toEqual(outlines(font))
  })

  it('decodes glyphs that were not padded to 4 bytes', async () => {
    // Reconstruction pads each glyph, so glyf comes out larger than declared
    const font = buildFont([simpleGlyph(5), simpleGlyph(5)], 1)
    const decoded = await roundTrip(font)
    expect(outlines(decoded)).toEqual(outlines(font))

    const glyf = getTable(decoded, 'glyf')
    expect(glyf.byteLength).toBe(64)
    const maxp = getTable(decoded, 'maxp')
    expect(maxp.byteOffset - decoded.byteOffset + 8).toBe(decoded.byteLength)
  })

  it('treats a zero-contour glyph with a body as empty', async () => {
    const zeroContour = new Uint8Array(12)
    const font = buildFont([zeroContour, simpleGlyph(40)], 4)
    const decoded = await roundTrip(font)
    expect(outlines(decoded)).toEqual(outlines(font))
  })

  it('keeps a non-zero LSB on an empty glyph', async () => {
    // Glyph 0 has lsb == xMin, which alone would allow dropping the LSBs
    const font = buildFont([simpleGlyph(40), new Uint8Array(0)], 4, [
      { advance: 500, lsb: 1 },
      { advance: 300, lsb: 7 },
    ])
    const decoded = await roundTrip(font)
    expect(Array.from(getTable(decoded, 'hmtx'))).toEqual(Array.from(getTable(font, 'hmtx')))
  })
})
