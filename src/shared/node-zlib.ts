// Node zlib lookup that works from both the CJS and ESM builds

type Zlib = typeof import('node:zlib')

export function loadNodeZlib(): Zlib | null {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) return null

    // require does not exist in ESM, getBuiltinModule covers Node 20.16+ / 22.3+
    if (typeof process.getBuiltinModule === 'function') {
      return process.getBuiltinModule('node:zlib') as Zlib
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:zlib')
  } catch {
    return null
  }
}
