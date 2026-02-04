// WOFF decoder
// https://www.w3.org/TR/WOFF/

const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'

type DecompressFn = (data: Uint8Array) => Promise<Uint8Array>

let zlibDecompress: DecompressFn | null = null
let browserDecompress: DecompressFn | null = null

function tryLoadZlib(): DecompressFn | null {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require('node:zlib')
      if (typeof zlib.inflateSync === 'function') {
        return async (data: Uint8Array) => {
          const result = zlib.inflateSync(data)
          return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
        }
      }
    }
  } catch {
    // Not in Node or zlib unavailable
  }
  return null
}

function tryLoadBrowserDeflate(): DecompressFn | null {
  try {
    if (typeof DecompressionStream !== 'undefined') {
      new DecompressionStream('deflate')
      return async (data: Uint8Array): Promise<Uint8Array> => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data)
            controller.close()
          },
        }).pipeThrough(new DecompressionStream('deflate'))
        return new Uint8Array(await new Response(stream).arrayBuffer())
      }
    }
  } catch {
    // DecompressionStream not available
  }
  return null
}

zlibDecompress = tryLoadZlib()
browserDecompress = tryLoadBrowserDeflate()

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (zlibDecompress) {
    return zlibDecompress(data)
  }
  if (browserDecompress) {
    return browserDecompress(data)
  }
  throw new Error('WOFF decode requires Node.js zlib or browser DecompressionStream API')
}

/**
 * Decode WOFF to TTF/OTF
 */
export async function woffDecode(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const input = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)

  // Validate signature
  const signature = view.getUint32(0)
  if (signature !== WOFF_SIGNATURE) {
    throw new Error('Invalid WOFF signature')
  }

  const flavor = view.getUint32(4)
  const numTables = view.getUint16(12)
  const totalSfntSize = view.getUint32(16)

  // Allocate output buffer
  const output = new Uint8Array(totalSfntSize)
  const outView = new DataView(output.buffer)

  // Write SFNT header
  outView.setUint32(0, flavor)
  outView.setUint16(4, numTables)
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16
  outView.setUint16(6, searchRange)
  outView.setUint16(8, Math.floor(Math.log2(numTables)))
  outView.setUint16(10, numTables * 16 - searchRange)

  // Read WOFF table directory
  const tables: Array<{
    tag: number
    offset: number
    compLength: number
    origLength: number
    checksum: number
  }> = []

  for (let i = 0; i < numTables; i++) {
    const dirOffset = 44 + i * 20
    tables.push({
      tag: view.getUint32(dirOffset),
      offset: view.getUint32(dirOffset + 4),
      compLength: view.getUint32(dirOffset + 8),
      origLength: view.getUint32(dirOffset + 12),
      checksum: view.getUint32(dirOffset + 16),
    })
  }

  // Sort by tag for SFNT output
  tables.sort((a, b) => a.tag - b.tag)

  // Decompress tables in parallel
  const decompressed = await Promise.all(
    tables.map(async (table) => {
      const tableData = input.subarray(table.offset, table.offset + table.compLength)
      if (table.compLength === table.origLength) {
        return tableData
      }
      const result = await decompress(tableData)
      if (result.byteLength !== table.origLength) {
        throw new Error(
          `Decompression size mismatch: expected ${table.origLength}, got ${result.byteLength}`
        )
      }
      return result
    })
  )

  // Write table directory and data
  let dataOffset = 12 + numTables * 16

  for (let i = 0; i < numTables; i++) {
    const table = tables[i]
    const dirOffset = 12 + i * 16

    outView.setUint32(dirOffset, table.tag)
    outView.setUint32(dirOffset + 4, table.checksum)
    outView.setUint32(dirOffset + 8, dataOffset)
    outView.setUint32(dirOffset + 12, table.origLength)

    output.set(decompressed[i], dataOffset)
    dataOffset += table.origLength

    // Pad to 4-byte boundary
    const padding = (4 - (table.origLength % 4)) % 4
    dataOffset += padding
  }

  return output.subarray(0, dataOffset)
}
