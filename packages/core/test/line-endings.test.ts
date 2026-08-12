/**
 * Line endings.
 *
 * GEDCOM's terminator production is `EOL = %x0D [%x0A] / %x0A`, so CRLF, a lone
 * CR and a lone LF are all conformant — and files assembled or edited by more
 * than one tool mix them within a single document. Parsing must not care.
 *
 * The first block is really a test of .gitattributes: it asserts the fixtures
 * still contain the bytes they were authored with. If the `fixtures/** -text`
 * rule were ever lost, a fresh clone would normalise every terminator to LF and
 * these fixtures would silently stop testing anything. Failing here is the point.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { splitLines } from '../src/lexer.ts';
import { bytes, fixture } from './corpus.ts';

/** Counts terminators in the raw bytes, without decoding. */
function terminators(raw: Uint8Array): { crlf: number; cr: number; lf: number } {
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0d) {
      if (raw[i + 1] === 0x0a) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (raw[i] === 0x0a) {
      lf++;
    }
  }
  return { crlf, cr, lf };
}

describe('fixtures survive checkout unnormalised', () => {
  it('keeps CRLF terminators', () => {
    const counts = terminators(fixture('line-endings/crlf.ged').bytes);
    expect(counts).toEqual({ crlf: 10, cr: 0, lf: 0 });
  });

  it('keeps lone CR terminators', () => {
    const counts = terminators(fixture('line-endings/cr.ged').bytes);
    expect(counts).toEqual({ crlf: 0, cr: 10, lf: 0 });
  });

  it('keeps lone LF terminators', () => {
    const counts = terminators(fixture('line-endings/lf.ged').bytes);
    expect(counts).toEqual({ crlf: 0, cr: 0, lf: 10 });
  });

  it('keeps a file that mixes all three', () => {
    const counts = terminators(fixture('line-endings/mixed.ged').bytes);
    expect(counts.crlf).toBeGreaterThan(0);
    expect(counts.cr).toBeGreaterThan(0);
    expect(counts.lf).toBeGreaterThan(0);
  });

  it('keeps the UTF-16 fixtures in their original byte order', () => {
    // Any text conversion would corrupt these outright.
    expect([...fixture('unicode/utf16le-multiscript.ged').bytes.slice(0, 2)]).toEqual([0xff, 0xfe]);
    expect([...fixture('unicode/utf16be-multiscript.ged').bytes.slice(0, 2)]).toEqual([0xfe, 0xff]);
  });
});

describe('every terminator parses identically', () => {
  const variants = ['lf', 'crlf', 'cr', 'mixed'] as const;

  it.each(variants)('%s.ged yields the same tree', (variant) => {
    const analysis = analyze(fixture(`line-endings/${variant}.ged`).bytes);

    expect(analysis.document.records.map((r) => r.tag)).toEqual(['HEAD', 'INDI', 'SNOTE', 'TRLR']);

    const indi = analysis.document.records[1]!;
    expect(indi.xref).toBe('I1');
    expect(indi.children.map((c) => c.tag)).toEqual(['NAME', 'SEX', 'BIRT']);
    expect(indi.children[0]!.payload).toBe('John /Smith/');
    expect(indi.children[2]!.children[0]!.payload).toBe('12 AUG 1901');
  });

  it.each(variants)('%s.ged reports no errors', (variant) => {
    const analysis = analyze(fixture(`line-endings/${variant}.ged`).bytes);
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });

  it('numbers lines consistently whatever the terminator', () => {
    // A CR-only file must not collapse into a single line, and a CRLF file must
    // not gain a blank line between every pair.
    for (const variant of variants) {
      const analysis = analyze(fixture(`line-endings/${variant}.ged`).bytes);
      const trlr = analysis.document.records.at(-1)!;
      expect(trlr.span.line).toBe(9);
    }
  });
});

describe('splitLines', () => {
  it('treats CRLF as one terminator, not two', () => {
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });

  it('splits on a lone CR', () => {
    expect(splitLines('a\rb')).toEqual(['a', 'b']);
  });

  it('handles a document mixing all three', () => {
    expect(splitLines('a\nb\r\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not invent a trailing line for a terminated file', () => {
    // A file ending in a terminator has an empty final element, which the lexer
    // skips; what matters is that it is not counted as a malformed line.
    const analysis = analyze(bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n'));
    expect(analysis.diagnostics.filter((d) => d.code === 'malformed-line')).toEqual([]);
  });
});
