// WOFF2 hmtx transform (section 5.4)
// Removes LSB values when they equal glyph xMin

import { SfntFont, GlyphInfo } from './sfnt'
import { WriteBuffer } from './write-buffer'
import { TAG_GLYF } from '../../shared/known-tags'

export interface TransformedHmtx {
  data: Uint8Array
}

// Returns null if no space savings possible
export function transformHmtx(
  font: SfntFont,
  hmtxData: Uint8Array,
  numHMetrics: number,
  glyphInfo: GlyphInfo
): TransformedHmtx | null {
  const { numGlyphs, glyphOffsets } = glyphInfo
  const glyfEntry = font.tables.get(TAG_GLYF)
  if (!glyfEntry) return null

  const view = new DataView(hmtxData.buffer, hmtxData.byteOffset, hmtxData.byteLength)

  // Check if we can eliminate proportional LSBs (lsb == xMin for all proportional glyphs)
  let canEliminateProportionalLsb = true
  // Check if we can eliminate monospace LSBs (lsb == xMin for all monospace glyphs)
  let canEliminateMonospaceLsb = numGlyphs > numHMetrics

  // Read advances and LSBs, compare with glyph xMin values
  const advances: number[] = []
  const proportionalLsbs: number[] = []
  const monospaceLsbs: number[] = []

  let hmtxOffset = 0

  for (let i = 0; i < numGlyphs; i++) {
    const glyphOffset = glyphOffsets[i]
    const glyphLength = glyphOffsets[i + 1] - glyphOffset
    
    // Get glyph xMin (0 for empty glyphs)
    let xMin = 0
    if (glyphLength > 0) {
      const glyphStart = glyfEntry.offset + glyphOffset
      // xMin is at offset 2 in glyph header (after numberOfContours)
      xMin = font.view.getInt16(glyphStart + 2)
    }

    if (i < numHMetrics) {
      // Proportional glyph: has advance + lsb
      const advance = view.getUint16(hmtxOffset)
      const lsb = view.getInt16(hmtxOffset + 2)
      hmtxOffset += 4

      advances.push(advance)
      proportionalLsbs.push(lsb)

      if (glyphLength > 0 && lsb !== xMin) {
        canEliminateProportionalLsb = false
      }
    } else {
      // Monospace glyph: only lsb
      const lsb = view.getInt16(hmtxOffset)
      hmtxOffset += 2

      monospaceLsbs.push(lsb)

      if (glyphLength > 0 && lsb !== xMin) {
        canEliminateMonospaceLsb = false
      }
    }

    // Early exit if no optimization possible
    if (!canEliminateProportionalLsb && !canEliminateMonospaceLsb) {
      return null
    }
  }

  // Build transformed hmtx
  // flags byte: bit 0 = proportional LSBs eliminated, bit 1 = monospace LSBs eliminated
  let flags = 0
  if (canEliminateProportionalLsb) flags |= 0x01
  if (canEliminateMonospaceLsb) flags |= 0x02

  // Calculate size
  let size = 1 + advances.length * 2 // flags + advances
  if (!canEliminateProportionalLsb) size += proportionalLsbs.length * 2
  if (!canEliminateMonospaceLsb) size += monospaceLsbs.length * 2

  // Don't transform if it doesn't save space
  if (size >= hmtxData.byteLength) {
    return null
  }

  const output = new WriteBuffer(size)
  output.writeU8(flags)

  // Write advances
  for (const advance of advances) {
    output.writeU16(advance)
  }

  // Write proportional LSBs if not eliminated
  if (!canEliminateProportionalLsb) {
    for (const lsb of proportionalLsbs) {
      output.writeS16(lsb)
    }
  }

  // Write monospace LSBs if not eliminated
  if (!canEliminateMonospaceLsb) {
    for (const lsb of monospaceLsbs) {
      output.writeS16(lsb)
    }
  }

  return { data: output.getBytes() }
}
