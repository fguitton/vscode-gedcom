/**
 * Non-Latin content.
 *
 * GEDCOM's *syntax* is ASCII — levels are digits, tags are uppercase letters —
 * but payloads carry names, places and notes in whatever script the family used,
 * and that is most of what a genealogy file contains. Nothing in the parser may
 * assume Latin text.
 *
 * The one place this gets subtle is column arithmetic. JavaScript strings are
 * UTF-16, so a character outside the basic multilingual plane occupies two code
 * units. Spans are therefore measured in UTF-16 code units, which is exactly what
 * LSP's default position encoding expects — an emoji advances a column count by
 * two, and an editor agrees.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { lex } from '../src/lexer.ts';
import { bytes } from './corpus.ts';

const SCRIPTS = {
  Japanese: '山田 /太郎/',
  Chinese: '/李/ 小龍',
  Korean: '/김/ 철수',
  Arabic: 'محمد /الخوارزمي/',
  Hebrew: 'משה /רבינו/',
  Greek: 'Αρχιμήδης /Συρακούσιος/',
  Cyrillic: 'Пётр /Чайковский/',
  Devanagari: '/गांधी/ मोहनदास',
  Thai: '/สมิธ/ สมชาย',
  Vietnamese: 'Nguyễn /Trãi/',
  'combining marks': 'Amélie /Poulain/',
  emoji: 'Ada /Lovelace/ 👩‍💻',
  'astral plane': '𒀭𒂗𒆠 /𒌷𒀖/',
} as const;

describe('payloads in any script', () => {
  it.each(Object.entries(SCRIPTS))('carries a %s name through unchanged', (_script, name) => {
    const analysis = analyze(
      bytes(`0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME ${name}\n0 TRLR\n`),
    );
    const indi = analysis.document.records.find((r) => r.tag === 'INDI')!;
    expect(indi.children[0]!.payload).toBe(name);
    expect(analysis.diagnostics.filter((d) => d.code === 'malformed-line')).toEqual([]);
  });

  it('handles a place name with mixed scripts and punctuation', () => {
    const place = '京都市, 日本 / Kyōto, Japan';
    const analysis = analyze(
      bytes(`0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 BIRT\n2 PLAC ${place}\n0 TRLR\n`),
    );
    const plac = analysis.document.structures.find((s) => s.tag === 'PLAC')!;
    expect(plac.payload).toBe(place);
  });

  it('folds continuations of non-Latin text', () => {
    const analysis = analyze(
      bytes('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @N1@ SNOTE 第一行\n1 CONT 第二行\n0 TRLR\n'),
    );
    const note = analysis.document.records.find((r) => r.tag === 'SNOTE')!;
    expect(note.payload).toBe('第一行\n第二行');
  });
});

describe('spans over non-Latin text', () => {
  it('measures columns in UTF-16 code units, as LSP expects', () => {
    const line = '1 NAME 山田 /太郎/';
    const { lines } = lex(line);
    const lexed = lines[0]!;

    // The tag span must still address exactly the tag.
    expect(line.slice(lexed.tagSpan.start, lexed.tagSpan.end)).toBe('NAME');
    // And the payload span exactly the payload, non-Latin characters included.
    expect(line.slice(lexed.payloadSpan!.start, lexed.payloadSpan!.end)).toBe('山田 /太郎/');
  });

  it('accounts for astral characters occupying two code units', () => {
    const line = '1 NOTE 𒀭 after';
    const { lines } = lex(line);
    const lexed = lines[0]!;
    expect(line.slice(lexed.payloadSpan!.start, lexed.payloadSpan!.end)).toBe('𒀭 after');
    // '𒀭' is one character but two UTF-16 units, so the payload is 8 units wide.
    expect(lexed.payloadSpan!.end - lexed.payloadSpan!.start).toBe(8);
  });

  it('keeps pointer spans exact when the line contains non-Latin text', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @F1@ FAM',
      '0 @I1@ INDI',
      '1 NAME 王 /小明/',
      '1 FAMS @F1@',
      '0 TRLR',
      '',
    ].join('\n');

    const { xrefs } = analyze(bytes(source));
    const reference = xrefs.references[0]!;
    const line = source.split('\n')[reference.span.line]!;
    expect(line.slice(reference.span.start, reference.span.end)).toBe('F1');
  });
});

describe('non-Latin cross-reference identifiers', () => {
  it('accepts them, though the specifications do not', () => {
    // GEDCOM 7 restricts xrefs to uppercase ASCII, digits and underscore, and
    // 5.5.1 requires a leading alphanumeric. Files in the wild ignore both.
    // Rejecting them at the lexer would lose the whole record; the parser stays
    // permissive and leaves the judgement to validation.
    const analysis = analyze(
      bytes('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @家族1@ FAM\n0 @I1@ INDI\n1 FAMS @家族1@\n0 TRLR\n'),
    );
    expect(analysis.xrefs.definitions.has('家族1')).toBe(true);
    expect(analysis.diagnostics.filter((d) => d.code === 'dangling-pointer')).toEqual([]);
  });
});

describe('encodings other than UTF-8', () => {
  it('decodes UTF-16 payloads in non-Latin scripts', () => {
    const source = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME 山田 /太郎/\n0 TRLR\n';
    const utf16 = new Uint8Array(2 + source.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      utf16[2 + i * 2] = code & 0xff;
      utf16[3 + i * 2] = code >> 8;
    }

    const analysis = analyze(utf16);
    expect(analysis.version).toBe('5.5.1');
    const name = analysis.document.structures.find((s) => s.tag === 'NAME')!;
    expect(name.payload).toBe('山田 /太郎/');
  });
});
