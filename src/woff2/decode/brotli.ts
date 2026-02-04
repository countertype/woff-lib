// Brotli decompression
// Tries Node zlib, then browser DecompressionStream, then pure JS

import { brotliDecode } from 'brotli-lib/decode'

type DecompressFn = (buf: Uint8Array) => Uint8Array
type AsyncDecompressFn = (buf: Uint8Array) => Promise<Uint8Array>

// Native zlib Brotli (Node 11.7+)
let nativeBrotli: DecompressFn | null = null

// Browser DecompressionStream with Brotli support (Firefox 113+, Safari 16.4+)
let browserBrotli: AsyncDecompressFn | null = null

function tryLoadNative(): DecompressFn | null {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require('node:zlib')
      if (typeof zlib.brotliDecompressSync === 'function') {
        return (buf: Uint8Array) => {
          const result = zlib.brotliDecompressSync(buf)
          return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
        }
      }
    }
  } catch {
    // Not in Node or zlib unavailable
  }
  return null
}

function tryLoadBrowserBrotli(): AsyncDecompressFn | null {
  try {
    if (typeof DecompressionStream !== 'undefined') {
      // Throws if 'brotli' format not supported (Chrome currently lacks it)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new DecompressionStream('brotli' as any)
      return async (buf: Uint8Array): Promise<Uint8Array> => {
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        const blob = new Blob([arrayBuf])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decompressed = blob.stream().pipeThrough(new DecompressionStream('brotli' as any))
        return new Uint8Array(await new Response(decompressed).arrayBuffer())
      }
    }
  } catch {
    // DecompressionStream doesn't support 'brotli' (Chrome) or not available
  }
  return null
}

nativeBrotli = tryLoadNative()
browserBrotli = tryLoadBrowserBrotli()

// Async decompress: tries native Node, then browser DecompressionStream, then pure JS
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (nativeBrotli) {
    return nativeBrotli(data)
  }
  if (browserBrotli) {
    return browserBrotli(data)
  }
  return brotliDecode(data)
}
