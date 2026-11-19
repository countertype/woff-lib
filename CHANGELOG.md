# Changelog

## 0.1.0 - 2026-11-18

### Changed
- Faster WOFF2 decode: glyf is rebuilt in place without per-glyph allocations, and checksums take one pass
- Faster WOFF2 encode: the glyf transform reads glyf bytes directly instead of parsing glyphs into objects
- In Node, the ESM build uses zlib directly instead of falling back to web streams

### Fixed
- Encoder produced corrupt output for fonts averaging more than 100 points per glyph
- Decoder threw when reconstructed glyf was larger than its declared length
- Encoder desynced streams on zero-contour glyphs with a non-empty body
- Encoder dropped non-zero LSBs of empty glyphs when transforming hmtx

## 0.0.3 - 2026-02-11

### Changed
- Update brotli-lib to 0.0.7
- Improve benchmarks

## 0.0.2 - 2026-02-04

### Added
- UMD build (`dist/woff2-decode.umd.js`) for script tag usage

## 0.0.1 - 2026-02-04

Initial release
