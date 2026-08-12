/**
 * Cross-reference index — the foundation of go-to-definition.
 *
 * The behaviour worth guarding hardest is what is *not* a pointer: 5.5.1 notes
 * are full of email addresses, and reading those as pointers is the same class of
 * mistake that made the old TextMate grammar unusable.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/index.ts';
import { definitionAt, referencesAt } from '../src/xref.ts';
import { bytes, fixture } from './corpus.ts';

const source = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 FAMS @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '0 TRLR',
  '',
].join('\n');

describe('index', () => {
  const { xrefs } = analyze(bytes(source));

  it('collects every definition', () => {
    expect([...xrefs.definitions.keys()].sort()).toEqual(['F1', 'I1', 'I2']);
    expect(xrefs.definitions.get('F1')?.tag).toBe('FAM');
  });

  it('collects every reference', () => {
    expect(xrefs.references.map((r) => r.xref)).toEqual(['F1', 'F1', 'I1', 'I2']);
  });

  it('groups references by target', () => {
    expect(xrefs.referencesTo.get('F1')).toHaveLength(2);
  });

  it('spans the identifier without the at-signs', () => {
    const reference = xrefs.references[0]!;
    const line = source.split('\n')[reference.span.line]!;
    expect(line.slice(reference.span.start, reference.span.end)).toBe('F1');
  });
});

describe('what counts as a pointer', () => {
  it('ignores an at-sign inside ordinary text', () => {
    const { xrefs } = analyze(bytes('0 HEAD\n0 @N1@ NOTE me@example.com is my email\n0 TRLR\n'));
    expect(xrefs.references).toEqual([]);
    expect(xrefs.diagnostics).toEqual([]);
  });

  it('ignores a payload that merely starts with an at-sign', () => {
    const { xrefs } = analyze(bytes('0 HEAD\n0 @N1@ SNOTE @@ escaped leading\n0 TRLR\n'));
    expect(xrefs.references).toEqual([]);
  });

  it('ignores a payload folded across continuations', () => {
    const { xrefs } = analyze(bytes('0 HEAD\n0 @N1@ NOTE @X@\n1 CONT more\n0 TRLR\n'));
    expect(xrefs.references).toEqual([]);
  });

  it('treats @VOID@ as a pointer to nothing, without complaint', () => {
    const { diagnostics } = analyze(bytes('0 HEAD\n1 SUBM @VOID@\n0 TRLR\n'));
    expect(diagnostics.filter((d) => d.code === 'dangling-pointer')).toEqual([]);
  });

  it('survives the pathological at-sign fixture', () => {
    const { xrefs } = analyze(fixture('v5/atsign.ged').bytes);
    expect(xrefs.diagnostics.filter((d) => d.code === 'dangling-pointer')).toEqual([]);
  });
});

describe('diagnostics', () => {
  it('reports a dangling pointer', () => {
    const { diagnostics } = analyze(bytes('0 HEAD\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n'));
    const dangling = diagnostics.filter((d) => d.code === 'dangling-pointer');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.message).toContain('NOPE');
  });

  it('accepts a pointer to a record defined later in the file', () => {
    const { diagnostics } = analyze(
      bytes('0 HEAD\n0 @I1@ INDI\n1 FAMS @F1@\n0 @F1@ FAM\n0 TRLR\n'),
    );
    expect(diagnostics.filter((d) => d.code === 'dangling-pointer')).toEqual([]);
  });

  it('reports a duplicate identifier', () => {
    const { diagnostics } = analyze(bytes('0 HEAD\n0 @I1@ INDI\n0 @I1@ INDI\n0 TRLR\n'));
    expect(diagnostics.filter((d) => d.code === 'duplicate-xref')).toHaveLength(1);
  });
});

describe('navigation', () => {
  const { xrefs } = analyze(bytes(source));

  it('resolves a pointer to its record', () => {
    // Line 5 is `1 FAMS @F1@`; the identifier starts at column 7.
    expect(definitionAt(xrefs, 5, 8)?.tag).toBe('FAM');
    expect(definitionAt(xrefs, 5, 8)?.xref).toBe('F1');
  });

  it('finds every use from the definition', () => {
    // Line 8 is `0 @F1@ FAM`.
    expect(referencesAt(xrefs, 8, 3)).toHaveLength(2);
  });

  it('finds every use from a reference', () => {
    expect(referencesAt(xrefs, 5, 8)).toHaveLength(2);
  });

  it('resolves nothing where there is no pointer', () => {
    expect(definitionAt(xrefs, 4, 5)).toBeUndefined();
  });
});
