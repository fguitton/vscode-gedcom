/**
 * Registry-driven validation.
 *
 * Two things are being checked here: that real violations are caught, and — just
 * as important — that valid files stay quiet. A validator that cries wolf on
 * ordinary 5.5.1 exports is one users disable.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { labelOf, modelFor, resolveSubstructure, tagLabel } from '../src/spec/index.ts';
import { bytes, fixture, fixtures } from './corpus.ts';

const v7 = (body: string) => bytes(`0 HEAD\n1 GEDC\n2 VERS 7.0\n${body}0 TRLR\n`);
const v5 = (body: string) => bytes(`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n${body}0 TRLR\n`);

const codes = (input: Uint8Array) => analyze(input).diagnostics.map((d) => d.code);

describe('the spec model', () => {
  it('resolves a tag within its enclosing context', () => {
    const model = modelFor('7.0');
    expect(resolveSubstructure(model, 'record-INDI', 'BIRT')?.slug).toBe('BIRT');
    expect(resolveSubstructure(model, 'record-INDI', 'HUSB')).toBeNull();
  });

  it('distinguishes structures that share a tag', () => {
    // DATE under BIRT and DATE under CHAN are different structures.
    const model = modelFor('7.0');
    const birthDate = resolveSubstructure(model, 'BIRT', 'DATE')?.slug;
    const changeDate = resolveSubstructure(model, 'CHAN', 'DATE')?.slug;
    expect(birthDate).not.toBe(changeDate);
  });

  it('carries labels for hovers', () => {
    expect(labelOf(modelFor('7.0'), 'record-INDI')).toBeTruthy();
  });

  it('falls back to the 7.x label for a 5.5.1 structure', () => {
    // Only the 7.x registry carries labels, and the vocabularies overlap.
    expect(labelOf(modelFor('5.5.1'), 'record-INDI')).toBeTruthy();
  });
});

describe('strict validation of GEDCOM 7', () => {
  it('accepts a well-formed document', () => {
    expect(codes(v7('0 @I1@ INDI\n1 NAME John /Smith/\n'))).toEqual([]);
  });

  it('reports a tag that is not permitted in its context', () => {
    expect(codes(v7('0 @I1@ INDI\n1 HUSB @VOID@\n'))).toContain('tag-not-allowed-here');
  });

  it('reports a tag that is not in the vocabulary', () => {
    expect(codes(v7('0 @I1@ INDI\n1 ZZTOP nonsense\n'))).toContain('unknown-tag');
  });

  it('reports a repeated substructure that may only appear once', () => {
    expect(codes(v7('0 @I1@ INDI\n1 SEX M\n1 SEX F\n'))).toContain('cardinality-violation');
  });

  it('reports an invalid enumerated value', () => {
    expect(codes(v7('0 @I1@ INDI\n1 SEX Q\n'))).toContain('enum-value-unknown');
  });

  it('accepts every valid enumerated value', () => {
    for (const sex of ['M', 'F', 'X', 'U']) {
      expect(codes(v7(`0 @I1@ INDI\n1 SEX ${sex}\n`))).not.toContain('enum-value-unknown');
    }
  });

  it('reports a pointer aimed at the wrong record type', () => {
    const input = v7('0 @I1@ INDI\n1 FAMS @I2@\n0 @I2@ INDI\n');
    expect(codes(input)).toContain('pointer-target-mismatch');
  });

  it('accepts a pointer aimed at the right record type', () => {
    const input = v7('0 @I1@ INDI\n1 FAMS @F1@\n0 @F1@ FAM\n');
    expect(codes(input)).not.toContain('pointer-target-mismatch');
  });
});

describe('extension tags', () => {
  it('accepts an extension declared in HEAD.SCHMA', () => {
    const input = bytes(
      [
        '0 HEAD',
        '1 GEDC',
        '2 VERS 7.0',
        '1 SCHMA',
        '2 TAG _LOC http://genealogy.net/GEDCOM#_LOC',
        '0 @I1@ INDI',
        '1 _LOC somewhere',
        '0 TRLR',
        '',
      ].join('\n'),
    );
    expect(codes(input)).not.toContain('undocumented-extension');
  });

  it('hints at an undeclared extension without calling it an error', () => {
    const analysis = analyze(v7('0 @I1@ INDI\n1 _UID 4F2A\n'));
    const hint = analysis.diagnostics.find((d) => d.code === 'undocumented-extension');
    expect(hint?.severity).toBe('hint');
  });

  it('never reports an extension tag as unknown', () => {
    expect(codes(v7('0 @I1@ INDI\n1 _WHATEVER x\n'))).not.toContain('unknown-tag');
  });
});

describe('lenient validation of 5.5.1', () => {
  it('does not enforce placement rules', () => {
    // The same document reported as an error under GEDCOM 7.
    expect(codes(v5('0 @I1@ INDI\n1 HUSB @VOID@\n'))).not.toContain('tag-not-allowed-here');
  });

  it('does not enforce cardinality', () => {
    expect(codes(v5('0 @I1@ INDI\n1 SEX M\n1 SEX F\n'))).not.toContain('cardinality-violation');
  });

  it('still reports a tag unknown to the whole vocabulary', () => {
    expect(codes(v5('0 @I1@ INDI\n1 ZZTOP nonsense\n'))).toContain('unknown-tag');
  });

  it('still reports a dangling pointer', () => {
    expect(codes(v5('0 @I1@ INDI\n1 FAMS @NOPE@\n'))).toContain('dangling-pointer');
  });
});

describe('the corpus stays quiet', () => {
  // Fixtures whose whole purpose is to be wrong.
  const deliberatelyInvalid = new Set([
    'v5/age-invalid.ged',
    'v7/age-invalid.ged',
    'v5/date-dual-invalid.ged',
    'v7/date-dual-invalid.ged',
    'v5/obsolete-1.ged',
    'v7/obsolete-1.ged',
    // A real MyHeritage export, kept exactly as exported. It carries literal
    // newlines inside CONC payloads, references records it does not define, and
    // ends without a TRLR. Its whole value is being wrong in the ways real files
    // are wrong; see the exporter notes in fixtures/README.md.
    'exporter/my-heritage.ged',
  ]);

  const subjects = fixtures().filter((f) => !deliberatelyInvalid.has(f.name));

  it.each(subjects.map((f) => f.name))('%s produces no malformed-line errors', (name) => {
    const analysis = analyze(fixture(name).bytes);
    const malformed = analysis.diagnostics
      .filter((d) => d.code === 'malformed-line')
      .map((d) => `line ${d.span.line + 1}`);
    expect(malformed).toEqual([]);
  });

  it.each(
    subjects
      // xref-case.ged exists to probe case sensitivity and contains a reference
      // that deliberately does not resolve; see the test below.
      .filter((f) => f.name !== 'v5/xref-case.ged')
      .map((f) => f.name),
  )('%s resolves every pointer', (name) => {
    const analysis = analyze(fixture(name).bytes);
    const dangling = analysis.diagnostics
      .filter((d) => d.code === 'dangling-pointer')
      .map((d) => `line ${d.span.line + 1}: ${d.message}`);
    expect(dangling).toEqual([]);
  });
});

describe('cross-reference identifiers are case-sensitive', () => {
  // GEDCOM 7 permits only uppercase in an identifier, so the question only
  // arises for 5.5.1, where identifiers are compared as written. fixtures/v5/
  // xref-case.ged pairs `1 SUBM @test@` with `0 @TEST@ SUBM` to probe exactly
  // this, alongside `@NoTe@` pairs that do match exactly.
  const analysis = analyze(fixture('v5/xref-case.ged').bytes);

  it('resolves identifiers that match exactly, including mixed case', () => {
    expect(analysis.xrefs.definitions.has('NoTe')).toBe(true);
    expect(analysis.xrefs.definitions.has('NoTe ref')).toBe(true);
    const dangling = analysis.diagnostics.filter((d) => d.code === 'dangling-pointer');
    expect(dangling.map((d) => d.message).join()).not.toContain('NoTe');
  });

  it('does not resolve a reference differing only in case', () => {
    const dangling = analysis.diagnostics.filter((d) => d.code === 'dangling-pointer');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.message).toContain('@test@');
  });
});

describe('tags removed between versions', () => {
  const v7 = (body: string) => bytes(`0 HEAD\n1 GEDC\n2 VERS 7.0\n${body}0 TRLR\n`);
  const v5 = (body: string) => bytes(`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n${body}0 TRLR\n`);

  const messageFor = (input: Uint8Array, code: string) =>
    analyze(input).diagnostics.find((d) => d.code === code)?.message ?? '';

  it('names the replacement rather than calling the tag unknown', () => {
    // "not a tag in this version" is true and useless; the reader is converting
    // a file and needs to know what to write instead.
    const input = v7('0 @I1@ INDI\n1 RFN 12345\n');
    expect(codes(input)).toContain('removed-in-version');
    expect(codes(input)).not.toContain('unknown-tag');
    expect(messageFor(input, 'removed-in-version')).toContain('EXID');
  });

  it.each([
    ['AFN', 'EXID'],
    ['RIN', 'EXID'],
    ['FONE', 'TRAN'],
    ['ROMN', 'TRAN'],
    ['RELA', 'ROLE'],
  ])('maps %s to %s', (tag, replacement) => {
    const input = v7(`0 @I1@ INDI\n1 ${tag} x\n`);
    expect(messageFor(input, 'removed-in-version')).toContain(replacement);
  });

  it('says so plainly when nothing replaced the tag', () => {
    const message = messageFor(v7('0 @I1@ INDI\n1 ANCE x\n'), 'removed-in-version');
    expect(message).toContain('no replacement');
  });

  it('reports a 7.0 tag in an older file as newer than the file claims', () => {
    const message = messageFor(v5('0 @I1@ INDI\n1 EXID x\n'), 'removed-in-version');
    expect(message).toContain('introduced after');
  });

  it('still reports a genuinely unknown tag as unknown', () => {
    expect(codes(v7('0 @I1@ INDI\n1 ZZTOP x\n'))).toContain('unknown-tag');
  });
});

describe('pointer payloads', () => {
  const messages = (input: Uint8Array) =>
    analyze(input)
      .diagnostics.filter((d) => d.code === 'malformed-pointer')
      .map((d) => d.message);

  it('accepts a payload that is exactly a pointer', () => {
    expect(codes(v7('0 @I1@ INDI\n1 ASSO @I1@\n2 ROLE OTHER\n'))).not.toContain(
      'malformed-pointer',
    );
  });

  it('rejects trailing text after a pointer', () => {
    // The case that slipped through: `asPointer` returns null, the reference is
    // never indexed, and nothing downstream ever looks at the payload again.
    const [message] = messages(v7('0 @I1@ INDI\n1 ASSO @I1@ df\n2 ROLE OTHER\n'));
    expect(message).toContain('takes a pointer and nothing else');
    expect(message).toContain('@I1@ df');
  });

  it('rejects a payload that is not a pointer at all', () => {
    expect(messages(v7('0 @I1@ INDI\n1 FAMC nonsense\n'))).toHaveLength(1);
  });

  it('reports a missing pointer payload', () => {
    expect(messages(v7('0 @I1@ INDI\n1 FAMC\n'))[0]).toContain('requires a pointer payload');
  });

  it('accepts @VOID@, which points nowhere on purpose', () => {
    expect(messages(v7('0 @I1@ INDI\n1 FAMC @VOID@\n'))).toEqual([]);
  });

  it('applies to 5.5.1 too, since it is wrong under any reading', () => {
    expect(messages(v5('0 @I1@ INDI\n1 FAMC @F1@ oops\n0 @F1@ FAM\n'))).toHaveLength(1);
  });
});

describe('diagnostics say what they judged against', () => {
  const message = (input: Uint8Array, code: string) =>
    analyze(input).diagnostics.find((d) => d.code === code)?.message ?? '';

  it('names the version and that the file declared it', () => {
    const text = message(v7('0 @I1@ INDI\n1 FLIB x\n'), 'unknown-tag');
    expect(text).toContain('GEDCOM 7.0');
    expect(text).toContain('HEAD.GEDC.VERS');
    expect(text).toContain('declares');
  });

  it('says when the version was inferred, and how to make it exact', () => {
    // No GEDC structure at all, but GEDCOM 7 vocabulary in use.
    const text = message(
      bytes('0 HEAD\n0 @I1@ INDI\n1 NAME John /Smith/\n2 TRAN Jean\n1 FLIB x\n0 TRLR\n'),
      'unknown-tag',
    );
    expect(text).toMatch(/inferred|default/);
    expect(text).toContain('HEAD.GEDC.VERS');
  });

  it('names both structures in English when a tag is misplaced', () => {
    const text = message(v7('0 @I1@ INDI\n1 CHIL @I1@\n'), 'tag-not-allowed-here');
    expect(text).toContain('Child');
    expect(text).toContain('Individual');
  });
});

describe('enumerated values in 5.5.1', () => {
  // The registry snapshot carries enumerations for GEDCOM 7 only, so until the
  // hand-written sets were used as a fallback a 5.5.1 file — which is most files
  // — had nothing to check coded values against. MyHeritage writes `QUAY 4`.
  const v551 = (body: string) =>
    analyze(bytes(`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n${body}0 TRLR\n`)).diagnostics;

  it('reports a confidence outside the four the specification defines', () => {
    const found = v551('0 @I1@ INDI\n1 SOUR @S1@\n2 QUAY 4\n0 @S1@ SOUR\n');
    const enums = found.filter((d) => d.code === 'enum-value-unknown');
    expect(enums.map((d) => d.message)).toEqual([
      '`4` is not a valid value for `QUAY`. Expected one of: 0, 1, 2, 3.',
    ]);
  });

  it('accepts the values that are defined', () => {
    for (const value of ['0', '1', '2', '3']) {
      const found = v551(`0 @I1@ INDI\n1 SOUR @S1@\n2 QUAY ${value}\n0 @S1@ SOUR\n`);
      expect(found.filter((d) => d.code === 'enum-value-unknown')).toEqual([]);
    }
  });

  it('reports a sex outside its set, in the older vocabulary too', () => {
    const found = v551('0 @I1@ INDI\n1 SEX Q\n');
    expect(found.some((d) => d.code === 'enum-value-unknown')).toBe(true);
  });
});

describe('English names in 5.5.1', () => {
  // `g7validation.json` is a GEDCOM 7 artefact, so the 5.5.1 model was generated
  // with no labels at all and every tag was shown to readers as a tag. Where a
  // tag means the same thing in both vocabularies, 7.0's name is borrowed.
  const model = modelFor('5.5.1');

  it('names the structures 7.0 agrees about', () => {
    expect(tagLabel(model, 'OCCU', 'OCCU')).toBe('Occupation');
    expect(tagLabel(model, 'QUAY', 'QUAY')).toBe('Quality of data');
    expect(tagLabel(model, 'TITL', 'TITL-DESCRIPTIVE_TITLE')).toBe('Title');
  });

  it('names the structures 7.0 removed, from the table written here', () => {
    // These have no 7.0 counterpart to borrow from at all.
    expect(tagLabel(model, 'AFN', 'AFN')).toBe('Ancestral File Number');
    expect(tagLabel(model, 'ANCE', 'ANCE')).toBe('Ancestors');
    expect(tagLabel(model, 'CHAR', 'CHAR')).toBe('Character set');
  });

  it('leaves no structure reading as its own tag', () => {
    const bare = Object.entries(model.tags)
      .filter(([slug, tag]) => tagLabel(model, tag, slug) === tag)
      .map(([slug]) => slug);
    expect(bare).toEqual([]);
  });
});
