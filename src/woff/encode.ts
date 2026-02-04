// WOFF encoder
// https://www.w3.org/TR/WOFF/

export interface WoffEncodeOptions {
  /** Compression level 1-9, default 9 */
  level?: number
}

const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'
const SFNT_HEADER_SIZE = 12
const SFNT_ENTRY_SIZE = 16
const WOFF_HEADER_SIZE = 44
const WOFF_ENTRY_SIZE = 20

type CompressFn = (data: Uint8Array, level: number) => Promise<Uint8Array>

let zlibCompress: CompressFn | null = null
let browserCompress: CompressFn | null = null

function tryLoadZlib(): CompressFn | null {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require('node:zlib')
      if (typeof zlib.deflateSync === 'function') {
        return async (data: Uint8Array, level: number) => {
          const result = zlib.deflateSync(data, { level })
          return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
        }
      }
    }
  } catch {
    // Not in Node or zlib unavailable
  }
  return null
}

function tryLoadBrowserDeflate(): CompressFn | null {
  try {
    if (typeof CompressionStream !== 'undefined') {
      new CompressionStream('deflate')
      return async (data: Uint8Array, _level: number): Promise<Uint8Array> => {
        // Note: CompressionStream doesn't support level parameter
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        }).pipeThrough(new CompressionStream('deflate'))
        return new Uint8Array(await new Response(stream).arrayBuffer())
      }
    }
  } catch {
    // CompressionStream not available
  }
  return null
}

zlibCompress = tryLoadZlib()
browserCompress = tryLoadBrowserDeflate()

async function compress(data: Uint8Array, level: number): Promise<Uint8Array> {
  if (zlibCompress) {
    return zlibCompress(data, level)
  }
  if (browserCompress) {
    return browserCompress(data, level)
  }
  throw new Error('WOFF encode requires Node.js zlib or browser CompressionStream API')
}

function pad4(n: number): number {
  return (n + 3) & ~3
}

interface TableInfo {
  tag: number
  checksum: number
  offset: number
  length: number
}

/**
 * Encode TTF/OTF to WOFF
 */
export async function woffEncode(
  data: ArrayBuffer | Uint8Array,
  options?: WoffEncodeOptions
): Promise<Uint8Array> {
  const input = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const level = options?.level ?? 9

  // Parse SFNT header
  const flavor = view.getUint32(0)
  const numTables = view.getUint16(4)

  // Read table directory
  const tables: TableInfo[] = []
  for (let i = 0; i < numTables; i++) {
    const offset = SFNT_HEADER_SIZE + i * SFNT_ENTRY_SIZE
    tables.push({
      tag: view.getUint32(offset),
      checksum: view.getUint32(offset + 4),
      offset: view.getUint32(offset + 8),
      length: view.getUint32(offset + 12),
    })
  }

  // Compress tables in parallel
  const compressed = await Promise.all(
    tables.map(async (t) => {
      const raw = input.subarray(t.offset, t.offset + t.length)
      const comp = await compress(raw, level)
      // Use compressed only if smaller
      return comp.length < raw.length
        ? { data: comp, compLength: comp.length, origLength: t.length }
        : { data: raw, compLength: t.length, origLength: t.length }
    })
  )

  // Calculate totalSfntSize (what the decompressed font would be)
  let totalSfntSize = SFNT_HEADER_SIZE + numTables * SFNT_ENTRY_SIZE
  for (const t of tables) {
    totalSfntSize += pad4(t.length)
  }

  // Calculate WOFF output size
  let woffLength = WOFF_HEADER_SIZE + numTables * WOFF_ENTRY_SIZE
  for (const c of compressed) {
    woffLength += pad4(c.compLength)
  }

  // Allocate output
  const output = new Uint8Array(woffLength)
  const outView = new DataView(output.buffer)

  // Write WOFF header
  outView.setUint32(0, WOFF_SIGNATURE)
  outView.setUint32(4, flavor)
  outView.setUint32(8, woffLength)
  outView.setUint16(12, numTables)
  outView.setUint16(14, 0) // reserved
  outView.setUint32(16, totalSfntSize)
  outView.setUint16(20, 0) // majorVersion
  outView.setUint16(22, 0) // minorVersion
  outView.setUint32(24, 0) // metaOffset
  outView.setUint32(28, 0) // metaLength
  outView.setUint32(32, 0) // metaOrigLength
  outView.setUint32(36, 0) // privOffset
  outView.setUint32(40, 0) // privLength

  // Write table directory and data
  // Tables should be in same order as input (already sorted by tag in valid SFNT)
  let dataOffset = WOFF_HEADER_SIZE + numTables * WOFF_ENTRY_SIZE

  for (let i = 0; i < numTables; i++) {
    const t = tables[i]
    const c = compressed[i]
    const dirOffset = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE

    // Directory entry
    outView.setUint32(dirOffset, t.tag)
    outView.setUint32(dirOffset + 4, dataOffset)
    outView.setUint32(dirOffset + 8, c.compLength)
    outView.setUint32(dirOffset + 12, c.origLength)
    outView.setUint32(dirOffset + 16, t.checksum)

    // Table data
    output.set(c.data, dataOffset)
    dataOffset += pad4(c.compLength)
  }

  return output
}
