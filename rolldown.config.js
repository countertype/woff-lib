import { defineConfig } from 'rolldown'

export default defineConfig([
  // Main entry (all exports)
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.js', format: 'esm' },
      { file: 'dist/index.cjs', format: 'cjs' },
    ],
    external: ['brotli-lib', 'brotli-lib/decode', 'brotli-lib/encode'],
  },
  // All decode (woff1 + woff2)
  {
    input: 'src/decode.ts',
    output: [
      { file: 'dist/decode.js', format: 'esm' },
      { file: 'dist/decode.cjs', format: 'cjs' },
    ],
    external: ['brotli-lib', 'brotli-lib/decode'],
  },
  // All encode (woff1 + woff2)
  {
    input: 'src/encode.ts',
    output: [
      { file: 'dist/encode.js', format: 'esm' },
      { file: 'dist/encode.cjs', format: 'cjs' },
    ],
    external: ['brotli-lib', 'brotli-lib/encode'],
  },
  // WOFF decode only
  {
    input: 'src/woff-decode.ts',
    output: [
      { file: 'dist/woff-decode.js', format: 'esm' },
      { file: 'dist/woff-decode.cjs', format: 'cjs' },
    ],
  },
  // WOFF encode only
  {
    input: 'src/woff-encode.ts',
    output: [
      { file: 'dist/woff-encode.js', format: 'esm' },
      { file: 'dist/woff-encode.cjs', format: 'cjs' },
    ],
  },
  // WOFF2 decode only
  {
    input: 'src/woff2-decode.ts',
    output: [
      { file: 'dist/woff2-decode.js', format: 'esm' },
      { file: 'dist/woff2-decode.cjs', format: 'cjs' },
    ],
    external: ['brotli-lib', 'brotli-lib/decode'],
  },
  // WOFF2 decode UMD (for script tag usage, bundles brotli-lib)
  {
    input: 'src/woff2-decode.ts',
    output: [
      { file: 'dist/woff2-decode.umd.js', format: 'iife', name: 'woffLib' },
    ],
  },
  // WOFF2 encode only
  {
    input: 'src/woff2-encode.ts',
    output: [
      { file: 'dist/woff2-encode.js', format: 'esm' },
      { file: 'dist/woff2-encode.cjs', format: 'cjs' },
    ],
    external: ['brotli-lib', 'brotli-lib/encode'],
  },
])
