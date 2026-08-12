/** Lexer and tree builder, including recovery from malformed input. */

import { describe, expect, it } from 'vitest';

import { lex } from '../src/lexer.ts';
import { parse, structureAt } from '../src/parser.ts';
import { walk } from '../src/cst.ts';
import { analyze } from '../src/index.ts';
import { fixture, fixtures, bytes } from './corpus.ts';

describe('lexer', () => {
  it('splits a line into its components', () => {
    const { lines } = lex('0 @I1@ INDI');
    expect(lines[0]).toMatchObject({ level: 0, xref: 'I1', tag: 'INDI', payload: null });
  });

  it('treats only the first space as the payload delimiter', () => {
    // CONT payloads encode their own leading whitespace.
    const { lines } = lex('2 CONT   indented');
    expect(lines[0]?.payload).toBe('  indented');
  });

  it('does not mistake a pointer payload for a cross-reference definition', () => {
    const { lines } = lex('1 SUBM @S1@');
    expect(lines[0]).toMatchObject({ xref: null, tag: 'SUBM', payload: '@S1@' });
  });

  it('accepts 5.5.1 cross-references containing spaces', () => {
    const { lines } = lex('0 @NoTe ref@ NOTE mixed');
    expect(lines[0]).toMatchObject({ xref: 'NoTe ref', tag: 'NOTE', payload: 'mixed' });
  });

  it('records spans that address the tag precisely', () => {
    const { lines } = lex('0 @I1@ INDI');
    const line = lines[0]!;
    expect('0 @I1@ INDI'.slice(line.tagSpan.start, line.tagSpan.end)).toBe('INDI');
    expect('0 @I1@ INDI'.slice(line.xrefSpan!.start, line.xrefSpan!.end)).toBe('@I1@');
  });

  it('reports padding without rejecting the line', () => {
    const { lines, diagnostics } = lex('0    HEAD');
    expect(lines[0]?.tag).toBe('HEAD');
    expect(diagnostics.map((d) => d.code)).toContain('multiple-delimiters');
  });

  it('reports a line that is not GEDCOM at all', () => {
    const { lines, diagnostics } = lex('0 HEAD\nnonsense\n0 TRLR');
    expect(lines).toHaveLength(2);
    expect(diagnostics.map((d) => d.code)).toContain('malformed-line');
  });

  it.each(['\n', '\r\n', '\r'])('handles %j line endings', (eol) => {
    const { lines } = lex(['0 HEAD', '1 GEDC', '0 TRLR'].join(eol));
    expect(lines.map((l) => l.tag)).toEqual(['HEAD', 'GEDC', 'TRLR']);
  });
});

describe('tree building', () => {
  it('nests by level', () => {
    const document = parse('0 @I1@ INDI\n1 BIRT\n2 DATE 1900\n1 NAME John\n0 TRLR');
    const indi = document.records[0]!;
    expect(indi.children.map((c) => c.tag)).toEqual(['BIRT', 'NAME']);
    expect(indi.children[0]!.children[0]!.tag).toBe('DATE');
    expect(indi.children[0]!.children[0]!.parent?.tag).toBe('BIRT');
  });

  it('folds CONT and CONC into the preceding payload', () => {
    const document = parse('0 @N1@ NOTE first\n1 CONT second\n1 CONC  and more\n0 TRLR');
    expect(document.records[0]!.payload).toBe('first\nsecond and more');
    expect(document.records[0]!.continuationLines).toEqual([1, 2]);
  });

  it('does not treat a continuation as a structure', () => {
    const document = parse('0 @N1@ NOTE first\n1 CONT second\n0 TRLR');
    expect(document.records[0]!.children).toEqual([]);
  });

  it('recovers from a skipped level rather than dropping the line', () => {
    const document = parse('0 @I1@ INDI\n3 DATE 1900\n0 TRLR');
    const indi = document.records[0]!;
    expect(indi.children.map((c) => c.tag)).toEqual(['DATE']);
    expect(document.diagnostics.map((d) => d.code)).toContain('level-skipped');
  });

  it('reports a cross-reference on a substructure', () => {
    const document = parse('0 @I1@ INDI\n1 @X@ BIRT\n0 TRLR');
    expect(document.diagnostics.map((d) => d.code)).toContain('xref-on-substructure');
  });

  it('reports a continuation with nothing to continue', () => {
    const document = parse('1 CONT orphaned\n0 TRLR');
    expect(document.diagnostics.map((d) => d.code)).toContain('continuation-without-target');
  });

  it('requires the HEAD/TRLR envelope', () => {
    const codes = parse('0 @I1@ INDI\n').diagnostics.map((d) => d.code);
    expect(codes).toContain('missing-header');
    expect(codes).toContain('missing-trailer');
  });

  it('locates the structure under a position', () => {
    const document = parse('0 @I1@ INDI\n1 BIRT\n2 DATE 1900\n0 TRLR');
    expect(structureAt(document, 2, 4)?.tag).toBe('DATE');
    expect(structureAt(document, 0, 2)?.tag).toBe('INDI');
  });
});

describe('the whole corpus parses', () => {
  it.each(fixtures().map((f) => f.name))('%s produces a tree', (name) => {
    const analysis = analyze(fixture(name).bytes);
    expect(analysis.document.records.length).toBeGreaterThan(0);

    // Every structure must be reachable from a record, and every parent link
    // must agree with the child list it came from.
    const reachable = analysis.document.records.flatMap((r) => [...walk(r)]);
    expect(reachable.length).toBe(analysis.document.structures.length);
    for (const structure of reachable) {
      for (const child of structure.children) expect(child.parent).toBe(structure);
    }
  });

  it('never throws, whatever the input', () => {
    const nasty = [
      '',
      '\n\n\n',
      '0',
      '0 ',
      '@',
      '999999 TAG',
      '0 HEAD\n￿\n0 TRLR',
      '2 CONT no parent',
      '0 @@ INDI',
    ];
    for (const input of nasty) {
      expect(() => analyze(bytes(input))).not.toThrow();
    }
  });
});
