// WOFF2 known table tags (section 4.1)
// Index < 63 uses single-byte encoding

export const KNOWN_TAGS: readonly number[] = [
  0x636d6170, // 0  cmap
  0x68656164, // 1  head
  0x68686561, // 2  hhea
  0x686d7478, // 3  hmtx
  0x6d617870, // 4  maxp
  0x6e616d65, // 5  name
  0x4f532f32, // 6  OS/2
  0x706f7374, // 7  post
  0x63767420, // 8  cvt 
  0x6670676d, // 9  fpgm
  0x676c7966, // 10 glyf
  0x6c6f6361, // 11 loca
  0x70726570, // 12 prep
  0x43464620, // 13 CFF 
  0x564f5247, // 14 VORG
  0x45424454, // 15 EBDT
  0x45424c43, // 16 EBLC
  0x67617370, // 17 gasp
  0x68646d78, // 18 hdmx
  0x6b65726e, // 19 kern
  0x4c545348, // 20 LTSH
  0x50434c54, // 21 PCLT
  0x56444d58, // 22 VDMX
  0x76686561, // 23 vhea
  0x766d7478, // 24 vmtx
  0x42415345, // 25 BASE
  0x47444546, // 26 GDEF
  0x47504f53, // 27 GPOS
  0x47535542, // 28 GSUB
  0x45425343, // 29 EBSC
  0x4a535446, // 30 JSTF
  0x4d415448, // 31 MATH
  0x43424454, // 32 CBDT
  0x43424c43, // 33 CBLC
  0x434f4c52, // 34 COLR
  0x4350414c, // 35 CPAL
  0x53564720, // 36 SVG 
  0x73626978, // 37 sbix
  0x61636e74, // 38 acnt
  0x61766172, // 39 avar
  0x62646174, // 40 bdat
  0x626c6f63, // 41 bloc
  0x62736c6e, // 42 bsln
  0x63766172, // 43 cvar
  0x66647363, // 44 fdsc
  0x66656174, // 45 feat
  0x666d7478, // 46 fmtx
  0x66766172, // 47 fvar
  0x67766172, // 48 gvar
  0x68737479, // 49 hsty
  0x6a757374, // 50 just
  0x6c636172, // 51 lcar
  0x6d6f7274, // 52 mort
  0x6d6f7278, // 53 morx
  0x6f706264, // 54 opbd
  0x70726f70, // 55 prop
  0x7472616b, // 56 trak
  0x5a617066, // 57 Zapf
  0x53696c66, // 58 Silf
  0x476c6174, // 59 Glat
  0x476c6f63, // 60 Gloc
  0x46656174, // 61 Feat
  0x53696c6c, // 62 Sill
] as const

// Table tag constants
export const TAG_GLYF = 0x676c7966
export const TAG_LOCA = 0x6c6f6361
export const TAG_HMTX = 0x686d7478
export const TAG_HHEA = 0x68686561
export const TAG_HEAD = 0x68656164
export const TAG_MAXP = 0x6d617870
export const TAG_CFF = 0x43464620
export const TAG_CFF2 = 0x43464632
export const TAG_DSIG = 0x44534947 // 'DSIG'

// TTC flavor signature
export const TTC_FLAVOR = 0x74746366 // 'ttcf'

// WOFF2 signature
export const WOFF2_SIGNATURE = 0x774f4632 // 'wOF2'

// SFNT signatures
export const SFNT_TTF = 0x00010000
export const SFNT_CFF = 0x4f54544f // 'OTTO'

// Transform flag bit
export const WOFF2_FLAGS_TRANSFORM = 1 << 5

// Convert 4-byte tag to string
export function tagToString(tag: number): string {
  return String.fromCharCode(
    (tag >> 24) & 0xff,
    (tag >> 16) & 0xff,
    (tag >> 8) & 0xff,
    tag & 0xff
  )
}

// Convert string to 4-byte tag
export function stringToTag(s: string): number {
  return (
    (s.charCodeAt(0) << 24) |
    (s.charCodeAt(1) << 16) |
    (s.charCodeAt(2) << 8) |
    s.charCodeAt(3)
  ) >>> 0
}

// Get known tag index (0-62) or 63 for arbitrary tag
let knownTagIndex: Map<number, number> | null = null

export function getKnownTagIndex(tag: number): number {
  if (!knownTagIndex) {
    knownTagIndex = new Map()
    for (let i = 0; i < KNOWN_TAGS.length; i++) {
      knownTagIndex.set(KNOWN_TAGS[i], i)
    }
  }
  return knownTagIndex.get(tag) ?? 63
}
