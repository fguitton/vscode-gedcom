/**
 * Registry-driven validation.
 *
 * Two things are being checked here: that real violations are caught, and — just
 * as important — that valid files stay quiet. A validator that cries wolf on
 * ordinary 5.5.1 exports is one users disable.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { labelOf, modelFor, resolveSubstructure } from '../src/spec/index.ts';
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
