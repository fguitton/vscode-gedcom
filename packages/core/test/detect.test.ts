/**
 * Version and encoding detection, against the official algorithm in
 * vendor/registries/version-detection.md.
 */

import { describe, expect, it } from 'vitest';

import { decode, detect, detectEncoding } from '../src/detect.ts';
import { analyze } from '../src/index.ts';
import { bytes, fixture, fixtures } from './corpus.ts';

describe('encoding detection', () => {
  it('reads width and byte order from the first two bytes', () => {
    expect(detectEncoding(new Uint8Array([0xff, 0xfe]))).toEqual({
      width: 2,
      order: 'LE',
      hasBom: true,
    });
    expect(detectEncoding(new Uint8Array([0xfe, 0xff]))).toEqual({
      width: 2,
      order: 'BE',
      hasBom: true,
    });
    // A stream always starts with "0", so an interleaved NUL identifies UTF-16
    // even with no byte-order mark.
    expect(detectEncoding(new Uint8Array([0x30, 0x00]))).toEqual({
      width: 2,
      order: 'LE',
      hasBom: false,
    });
    expect(detectEncoding(new Uint8Array([0x00, 0x30]))).toEqual({
      width: 2,
      order: 'BE',
      hasBom: false,
    });
    expect(detectEncoding(bytes('0 HEAD'))).toEqual({ width: 1, order: null, hasBom: false });
  });

  it.each([
    ['v5/char_utf16le-1.ged', 2, 'LE'],
    ['v5/char_utf16be-1.ged', 2, 'BE'],
    ['v5/char_utf8-1.ged', 1, null],
  ] as const)('detects %s as width %i %s', (name, width, order) => {
    const encoding = detectEncoding(fixture(name).bytes);
    expect(encoding.width).toBe(width);
    expect(encoding.order).toBe(order);
  });

  it('reads the v7 char_utf16 fixtures as single-byte', () => {
    // These are not UTF-16 despite their names. GEDCOM 7 is UTF-8 only, so the
    // fixtures are UTF-8 files whose NOTE payload discusses UTF-16 — they exist
    // to check that a 5.5.1 UTF-16 file converts to UTF-8 on the way to 7.0.
    for (const name of ['v7/char_utf16le-1.ged', 'v7/char_utf16be-1.ged']) {
      expect(detectEncoding(fixture(name).bytes).width).toBe(1);
    }
  });

  it('decodes UTF-16 correctly in both byte orders', () => {
    // The two fixtures differ only in their NOTE text, so compare structure and
    // the characters that actually exercise the decoder. `𒍅` is outside the
    // basic plane, so it proves surrogate pairs survive the big-endian swap.
    for (const name of ['v5/char_utf16le-1.ged', 'v5/char_utf16be-1.ged']) {
      const text = decode(fixture(name).bytes);
      expect(text.startsWith('0 HEAD')).toBe(true);
      expect(text).toContain('2 VERS 5.5.1');
      expect(text).toContain('¶ ☺ 𒍅');
      expect(text.trimEnd().endsWith('0 TRLR')).toBe(true);
    }
  });

  it('strips a leading byte-order mark', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('0 HEAD')]);
    expect(decode(withBom)).toBe('0 HEAD');
  });
});

describe('version detection', () => {
  const header = (version: string) => `0 HEAD\n1 GEDC\n2 VERS ${version}\n0 TRLR\n`;

  it.each([
    ['7.0', '7.0'],
    ['7.0.18', '7.0'],
    ['5.5.1', '5.5.1'],
    ['5.5.5', '5.5.5'],
    ['5.5', '5.5'],
    ['5.6', '5.6'],
    ['5.4', '5.4'],
    ['5.3', '5.3'],
    ['5.0', '5.0'],
    ['4.0', '4.0'],
  ])('reads "%s" as %s', (text, expected) => {
    expect(detect(bytes(header(text))).version).toBe(expected);
  });

  it('prefers the longest match', () => {
    // 5.5.5 and 5.5.1 both extend 5.5; the longer pattern must win.
    expect(detect(bytes(header('5.5.5'))).version).toBe('5.5.5');
    expect(detect(bytes(header('5.5.1'))).version).toBe('5.5.1');
    expect(detect(bytes(header('5.5'))).version).toBe('5.5');
  });

  it('falls back to 3.0 for an unrecognised version', () => {
    expect(detect(bytes(header('9.9'))).version).toBe('3.0');
  });

  it('reports null when the file is not GEDCOM', () => {
    expect(detect(bytes('this is not a gedcom file')).version).toBeNull();
    // Present but truncated before the version.
    expect(detect(bytes('0 HEAD\n1 GEDC\n')).version).toBeNull();
  });

  it('identifies PAF-era files through 1 SYST', () => {
    const result = detect(bytes('0 HEAD\n1 SYST PAF\n'));
    expect(result.isPaf).toBe(true);
    expect(result.version).toBe('PAF');
  });

  it('works through UTF-16 in both byte orders', () => {
    const utf16 = (text: string, order: 'LE' | 'BE') => {
      const out = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (order === 'LE') {
          out[i * 2] = code & 0xff;
          out[i * 2 + 1] = code >> 8;
        } else {
          out[i * 2] = code >> 8;
          out[i * 2 + 1] = code & 0xff;
        }
      }
      return out;
    };

    expect(detect(utf16(header('7.0'), 'LE')).version).toBe('7.0');
    expect(detect(utf16(header('7.0'), 'BE')).version).toBe('7.0');
    expect(detect(utf16(header('5.5.1'), 'BE')).version).toBe('5.5.1');
  });

  it('cannot identify a file with no GEDC structure', () => {
    // Formally correct: the algorithm requires 1 GEDC followed by 2 VERS, and a
    // file lacking them "is not a valid GEDCOM file". Both of these are real.
    expect(detect(fixture('v5/tiny-1.ged').bytes).version).toBeNull();
    expect(detect(fixture('v5/Royal92.ged').bytes).version).toBeNull();
  });

  it('identifies a version for every fixture that carries one', () => {
    const undetectable = new Set(['v5/tiny-1.ged', 'v5/Royal92.ged']);
    const unidentified = fixtures()
      .filter((f) => !undetectable.has(f.name) && detect(f.bytes).version === null)
      .map((f) => f.name);
    expect(unidentified).toEqual([]);
  });

  it('agrees with the directory each version-specific fixture lives in', () => {
    const undetectable = new Set(['v5/tiny-1.ged', 'v5/Royal92.ged']);
    const wrong = fixtures()
      // fixtures/unicode/ holds both generations; it is organised by script.
      .filter((f) => f.name.startsWith('v5/') || f.name.startsWith('v7/'))
      .filter((f) => !undetectable.has(f.name))
      .map((f) => ({ name: f.name, version: detect(f.bytes).version }))
      .filter(({ name, version }) =>
        name.startsWith('v7/') ? version !== '7.0' : !version?.startsWith('5.'),
      );
    expect(wrong).toEqual([]);
  });
});

describe('inference for undetectable files', () => {
  it('reads Royal92 as a 5.5.x file from its vocabulary', () => {
    // Linguist's own GEDCOM sample: a 1992 PAF export with no GEDC structure.
    // It uses CHAR and CONC, both removed in GEDCOM 7.
    const analysis = analyze(fixture('v5/Royal92.ged').bytes);
    expect(analysis.version).toBe('5.5.1');
  });

  it('reads a GEDC-less GEDCOM 7 file from its vocabulary', () => {
    const analysis = analyze(bytes('0 HEAD\n1 SCHMA\n0 @N1@ SNOTE hi\n0 TRLR\n'));
    expect(analysis.version).toBe('7.0');
  });

  it('gives up when there is no evidence either way', () => {
    expect(analyze(bytes('0 HEAD\n0 TRLR\n')).version).toBeNull();
  });

  it('validates an unidentifiable file leniently rather than strictly', () => {
    // The failure mode this guards against: painting a file we could not even
    // identify red with GEDCOM 7 conformance errors.
    const analysis = analyze(fixture('v5/Royal92.ged').bytes);
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.filter((d) => d.code === 'tag-not-allowed-here')).toEqual([]);
    expect(errors.filter((d) => d.code === 'cardinality-violation')).toEqual([]);
  });
});
