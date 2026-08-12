/**
 * GEDCOM version and encoding detection.
 *
 * Implements the official algorithm from
 * vendor/registries/version-detection.md. Two properties of that algorithm shape
 * this whole package:
 *
 *  - It runs on **bytes, before decoding**. A GEDCOM stream always begins with
 *    the character `0`, so the first two bytes reveal character width and byte
 *    order without knowing the character set. Decoding needs that answer first,
 *    which is why the parser's entry point takes a `Uint8Array` and not a string.
 *
 *  - It is a **byte scan, not a parse**. It searches for `1 GEDC` then `2 VERS `
 *    rather than walking a structure tree, so it still reports a version for
 *    files too malformed to parse.
 */

/** Versions the detection table can report. */
export type GedcomVersion =
  | '7.0'
  | '5.6'
  | '5.5.5'
  | '5.5.1'
  | '5.5 EL'
  | '5.5'
  | '5.4'
  | '5.3'
  | '5.0'
  | '4.0'
  | '3.0'
  | 'PAF';

export type ByteOrder = 'LE' | 'BE';

export interface Encoding {
  /** Bytes per character: 2 for UTF-16, 1 for everything else. */
  readonly width: 1 | 2;
  /** Byte order, only meaningful when width is 2. */
  readonly order: ByteOrder | null;
  /** Whether the stream opened with a byte-order mark. */
  readonly hasBom: boolean;
}

export interface Detection {
  /**
   * The detected version, or null when the stream is not a valid GEDCOM file —
   * that is, when it ends before `1 GEDC`/`2 VERS ` could be found.
   */
  readonly version: GedcomVersion | null;
  readonly encoding: Encoding;
  /** Byte offset of the version payload, for diagnostics. */
  readonly versionOffset: number | null;
  /**
   * True when the file identified itself through `1 SYST` rather than `1 GEDC`,
   * meaning a PAF-era file governed by a different specification.
   */
  readonly isPaf: boolean;
}

const BOM_LE = [0xff, 0xfe];
const BOM_BE = [0xfe, 0xff];
/** "0" as the low byte of a UTF-16LE character. */
const ZERO_LE = [0x30, 0x00];
/** "0" as the low byte of a UTF-16BE character. */
const ZERO_BE = [0x00, 0x30];

/**
 * Character width and byte order, from the first two bytes.
 * A GEDCOM stream starts with `0`, so an interleaved NUL identifies UTF-16 even
 * without a byte-order mark.
 */
export function detectEncoding(bytes: Uint8Array): Encoding {
  const head = [bytes[0], bytes[1]];
  const is = (pattern: number[]) => head[0] === pattern[0] && head[1] === pattern[1];

  if (is(BOM_LE)) return { width: 2, order: 'LE', hasBom: true };
  if (is(BOM_BE)) return { width: 2, order: 'BE', hasBom: true };
  if (is(ZERO_LE)) return { width: 2, order: 'LE', hasBom: false };
  if (is(ZERO_BE)) return { width: 2, order: 'BE', hasBom: false };

  // A UTF-8 byte-order mark is three bytes and does not change the width.
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { width: 1, order: null, hasBom: hasUtf8Bom };
}

/** Encodes ASCII text into the width and order given, for byte-level searching. */
function encodeAscii(text: string, { width, order }: Encoding): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (width === 1) out.push(code);
    else if (order === 'BE') out.push(0x00, code);
    else out.push(code, 0x00);
  }
  return out;
}

function indexOfSequence(haystack: Uint8Array, needle: number[], from = 0): number {
  if (needle.length === 0) return from;
  const limit = haystack.length - needle.length;
  outer: for (let i = from; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * The version table, longest match first.
 *
 * Note `5.5 EL`: version-detection.md lists its bytes as `35 2E 25 20 45`, but
 * `25` is `%` — the sequence for the string "5.5 E" is `35 2E 35 20 45`. Treating
 * that as an upstream typo and matching the real bytes; longest-match ordering
 * keeps it ahead of the `5.5` prefix it would otherwise collide with.
 */
const VERSION_TABLE: readonly (readonly [string, GedcomVersion])[] = [
  ['5.5.1', '5.5.1'],
  ['5.5.5', '5.5.5'],
  ['5.5 E', '5.5 EL'],
  ['7.0', '7.0'],
  ['5.6', '5.6'],
  ['5.5', '5.5'],
  ['5.4', '5.4'],
  ['5.3', '5.3'],
  ['5.0', '5.0'],
  ['4', '4.0'],
];

/** Detects version and encoding without decoding the stream. */
export function detect(bytes: Uint8Array): Detection {
  const encoding = detectEncoding(bytes);
  const notGedcom: Detection = {
    version: null,
    encoding,
    versionOffset: null,
    isPaf: false,
  };

  const gedcAt = indexOfSequence(bytes, encodeAscii('1 GEDC', encoding));

  // `1 SYST` is only defined for single-byte files.
  const systAt =
    encoding.width === 1 ? indexOfSequence(bytes, encodeAscii('1 SYST', encoding)) : -1;

  // Whichever marker comes first identifies the file.
  if (gedcAt < 0 && systAt < 0) return notGedcom;
  if (systAt >= 0 && (gedcAt < 0 || systAt < gedcAt)) {
    return { version: 'PAF', encoding, versionOffset: systAt, isPaf: true };
  }

  const versAt = indexOfSequence(bytes, encodeAscii('2 VERS ', encoding), gedcAt);
  if (versAt < 0) return notGedcom;

  const payloadAt = versAt + 7 * encoding.width;
  const window = bytes.subarray(payloadAt, payloadAt + 5 * encoding.width);
  if (window.length < encoding.width) return notGedcom;

  // Drop the NUL half of each UTF-16 unit, per the algorithm's step 5.
  const offset = encoding.width === 2 && encoding.order === 'BE' ? 1 : 0;
  let text = '';
  for (let i = offset; i < window.length; i += encoding.width) {
    text += String.fromCharCode(window[i]!);
  }

  for (const [prefix, version] of VERSION_TABLE) {
    if (text.startsWith(prefix)) {
      return { version, encoding, versionOffset: payloadAt, isPaf: false };
    }
  }

  // The table's catch-all: anything unrecognised is Release 3.0.
  return { version: '3.0', encoding, versionOffset: payloadAt, isPaf: false };
}

/**
 * Decodes a stream to text using the detected encoding.
 *
 * UTF-16BE is byte-swapped and decoded as little-endian rather than passed to
 * `TextDecoder('utf-16be')`, which is unavailable in runtimes built without full
 * ICU. Any leading byte-order mark is stripped.
 *
 * Single-byte streams are decoded as UTF-8. GEDCOM 5.5.1 also permitted ANSEL,
 * which no platform decoder implements; `HEAD.CHAR` reports it and conversion is
 * handled separately.
 */
export function decode(bytes: Uint8Array, encoding = detectEncoding(bytes)): string {
  if (encoding.width === 2) {
    let source = bytes;
    if (encoding.order === 'BE') {
      const swapped = new Uint8Array(bytes.length);
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        swapped[i] = bytes[i + 1]!;
        swapped[i + 1] = bytes[i]!;
      }
      source = swapped;
    }
    return new TextDecoder('utf-16le').decode(source).replace(/^﻿/, '');
  }
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}
