/**
 * Language features.
 *
 * They are pure functions over an analysis, so none of this needs a running
 * server — which is the point of keeping the transport in a separate file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  analyzeDocument,
  completion,
  definition,
  diagnostics,
  documentHighlights,
  documentSymbols,
  foldingRanges,
  hover,
  references,
  renameEdits,
  semanticTokens,
  semanticTokensLegend,
  summarize,
} from '../src/features.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', '..', 'fixtures');

const URI = 'file:///tree.ged';

const SOURCE = [
  '0 HEAD', //                          0
  '1 GEDC', //                          1
  '2 VERS 7.0', //                      2
  '0 @I1@ INDI', //                     3
  '1 NAME John /Smith/', //             4
  '1 SEX M', //                         5
  '1 BIRT', //                          6
  '2 DATE 12 AUG 1901', //              7
  '1 FAMS @F1@', //                     8
  '0 @I2@ INDI', //                     9
  '1 NAME Jane /Doe/', //              10
  '1 SEX F', //                        11
  '1 FAMS @F1@', //                    12
  '0 @F1@ FAM', //                     13
  '1 HUSB @I1@', //                    14
  '1 WIFE @I2@', //                    15
  '0 TRLR', //                         16
  '',
].join('\n');

const analysis = analyzeDocument(SOURCE);

/** Column of a substring on a line, for building positions readably. */
const at = (line: number, needle: string) => ({
  line,
  character: SOURCE.split('\n')[line]!.indexOf(needle) + 1,
});

describe('go to definition', () => {
  it('resolves a pointer to the record it names', () => {
    const location = definition(analysis, URI, at(8, 'F1'));
    expect(location?.range.start.line).toBe(13);
  });

  it('resolves from either use of the same identifier', () => {
    expect(definition(analysis, URI, at(12, 'F1'))?.range.start.line).toBe(13);
  });

  it('returns nothing where there is no pointer', () => {
    expect(definition(analysis, URI, at(4, 'John'))).toBeNull();
  });

  it('returns nothing for @VOID@', () => {
    const voided = analyzeDocument('0 HEAD\n1 SUBM @VOID@\n0 TRLR\n');
    expect(definition(voided, URI, { line: 1, character: 8 })).toBeNull();
  });
});

describe('find references', () => {
  it('finds every use from the definition', () => {
    const found = references(analysis, URI, at(13, 'F1'), false);
    expect(found.map((l) => l.range.start.line)).toEqual([8, 12]);
  });

  it('includes the declaration when asked', () => {
    const found = references(analysis, URI, at(8, 'F1'), true);
    expect(found.map((l) => l.range.start.line)).toEqual([13, 8, 12]);
  });

  it('highlights the definition and its uses differently', () => {
    const highlights = documentHighlights(analysis, at(13, 'F1'));
    expect(highlights.map((h) => h.kind)).toEqual([1, 2, 2]);
  });
});

describe('rename', () => {
  it('rewrites the definition and every pointer at once', () => {
    const edit = renameEdits(analysis, URI, at(8, 'F1'), 'FAMILY1');
    const edits = edit?.changes?.[URI] ?? [];
    expect(edits).toHaveLength(3);
    expect(edits.every((e) => e.newText === 'FAMILY1')).toBe(true);
  });

  it('edits the identifier without disturbing the at-signs', () => {
    const edit = renameEdits(analysis, URI, at(13, 'F1'), 'X');
    const definitionEdit = edit!.changes![URI]![0]!;
    const line = SOURCE.split('\n')[13]!;
    expect(
      line.slice(definitionEdit.range.start.character, definitionEdit.range.end.character),
    ).toBe('F1');
  });

  it('tolerates a new name written with at-signs', () => {
    const edit = renameEdits(analysis, URI, at(8, 'F1'), '@F2@');
    expect(edit!.changes![URI]![0]!.newText).toBe('F2');
  });

  it('refuses where there is no identifier', () => {
    expect(renameEdits(analysis, URI, at(4, 'John'), 'X')).toBeNull();
  });
});

describe('hover', () => {
  it('describes a tag with its specification label', () => {
    const text = hover(analysis, at(3, 'INDI'))?.contents;
    expect(JSON.stringify(text)).toContain('INDI');
    expect(JSON.stringify(text)).toContain('Individual');
  });

  it('describes what a pointer points at, not the tag again', () => {
    const text = JSON.stringify(hover(analysis, at(8, 'F1'))?.contents);
    expect(text).toContain('FAM');
    expect(text).toContain('John Smith + Jane Doe');
  });

  it('says so when a pointer resolves to nothing', () => {
    const broken = analyzeDocument('0 HEAD\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n');
    const text = JSON.stringify(hover(broken, { line: 2, character: 9 })?.contents);
    expect(text).toContain('no matching record');
  });

  it('marks an extension tag as such', () => {
    const extended = analyzeDocument('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 _UID x\n0 TRLR\n');
    const text = JSON.stringify(hover(extended, { line: 4, character: 3 })?.contents);
    expect(text).toContain('Extension tag');
  });

  it('reports how many times a record is referenced', () => {
    const text = JSON.stringify(hover(analysis, at(13, 'FAM'))?.contents);
    expect(text).toContain('2 references');
  });
});

describe('outline', () => {
  const symbols = documentSymbols(analysis);

  it('lists records at the top level', () => {
    expect(symbols.map((s) => s.name)).toEqual([
      'HEAD',
      'INDI @I1@',
      'INDI @I2@',
      'FAM @F1@',
      'TRLR',
    ]);
  });

  it('labels a person with their name', () => {
    expect(symbols[1]!.detail).toBe('John Smith');
  });

  it('labels a family with its spouses, resolved to names', () => {
    // The identifiers are what the reader is trying to look up, not what they
    // want to be told.
    expect(symbols[3]!.detail).toBe('John Smith + Jane Doe');
  });

  it('nests substructures', () => {
    const birth = symbols[1]!.children!.find((c) => c.name === 'BIRT')!;
    expect(birth.children!.map((c) => c.name)).toEqual(['DATE']);
  });

  it('spans a record from its first line to its last', () => {
    expect(symbols[1]!.range.start.line).toBe(3);
    expect(symbols[1]!.range.end.line).toBe(8);
  });
});

describe('folding', () => {
  const ranges = foldingRanges(analysis);

  it('folds a record over its whole extent', () => {
    expect(ranges).toContainEqual(expect.objectContaining({ startLine: 3, endLine: 8 }));
  });

  it('folds a substructure that has children', () => {
    expect(ranges).toContainEqual(expect.objectContaining({ startLine: 6, endLine: 7 }));
  });

  it('does not fold a leaf', () => {
    expect(ranges.find((r) => r.startLine === 5)).toBeUndefined();
  });
});

describe('completion', () => {
  it('offers tags valid inside the enclosing structure', () => {
    const items = completion(analysis, { line: 6, character: 2 }, '1 ');
    const labels = items.map((i) => i.label);
    expect(labels).toContain('BIRT');
    expect(labels).toContain('SEX');
    // HUSB belongs to FAM, not INDI.
    expect(labels).not.toContain('HUSB');
  });

  it('annotates each tag with its cardinality', () => {
    const sex = completion(analysis, { line: 6, character: 2 }, '1 ').find(
      (i) => i.label === 'SEX',
    );
    expect(JSON.stringify(sex?.documentation)).toContain('{0:1}');
  });

  it('offers records once a tag has been typed', () => {
    const items = completion(analysis, { line: 8, character: 7 }, '1 FAMS ');
    expect(items.map((i) => i.label)).toContain('@F1@');
    expect(items.find((i) => i.label === '@F1@')?.detail).toContain('FAM');
  });

  it('offers records at the document root', () => {
    const labels = completion(analysis, { line: 16, character: 2 }, '0 ').map((i) => i.label);
    expect(labels).toContain('INDI');
    expect(labels).toContain('FAM');
  });
});

describe('semantic tokens', () => {
  const data = semanticTokens(analysis);

  it('emits well-formed quintuples', () => {
    expect(data.length % 5).toBe(0);
    expect(data.length).toBeGreaterThan(0);
  });

  it('marks a tag valid in its context with defaultLibrary', () => {
    // Decode back into absolute positions to make the assertion readable.
    const tokens: { line: number; start: number; type: number; modifiers: number }[] = [];
    let line = 0;
    let start = 0;
    for (let i = 0; i < data.length; i += 5) {
      const deltaLine = data[i]!;
      const deltaStart = data[i + 1]!;
      line += deltaLine;
      start = deltaLine === 0 ? start + deltaStart : deltaStart;
      tokens.push({ line, start, type: data[i + 3]!, modifiers: data[i + 4]! });
    }

    const property = semanticTokensLegend.tokenTypes.indexOf('property');
    const defaultLibrary = 1 << semanticTokensLegend.tokenModifiers.indexOf('defaultLibrary');

    const indi = tokens.find((t) => t.line === 3 && t.type === property)!;
    expect(indi.modifiers & defaultLibrary).toBeTruthy();
  });

  it('marks a dangling pointer as deprecated', () => {
    const broken = analyzeDocument(
      '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n',
    );
    const raw = semanticTokens(broken);
    const deprecated = 1 << semanticTokensLegend.tokenModifiers.indexOf('deprecated');
    const modifiers = [];
    for (let i = 4; i < raw.length; i += 5) modifiers.push(raw[i]!);
    expect(modifiers.some((m) => (m & deprecated) !== 0)).toBe(true);
  });
});

describe('diagnostics', () => {
  it('maps severities and carries the code through', () => {
    const broken = analyzeDocument(
      '0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 FAMS @NOPE@\n0 TRLR\n',
    );
    const found = diagnostics(broken).find((d) => d.code === 'dangling-pointer')!;
    expect(found.severity).toBe(1);
    expect(found.source).toBe('gedcom');
    expect(found.range.start.line).toBe(4);
  });
});

describe('summaries', () => {
  it('strips the surname delimiters from a name', () => {
    expect(summarize(analysis.document.records[1]!)).toBe('John Smith');
  });
});

describe('against the real corpus', () => {
  const royal = analyzeDocument(readFileSync(join(fixtures, 'v5', 'Royal92.ged'), 'utf8'));

  it('builds an outline for a 30,000-line file', () => {
    const symbols = documentSymbols(royal);
    expect(symbols.length).toBeGreaterThan(3000);
  });

  it('resolves pointers throughout', () => {
    expect(royal.xrefs.definitions.size).toBeGreaterThan(3000);
    expect(royal.xrefs.references.length).toBeGreaterThan(3000);
  });

  it('produces folding ranges without collapsing the file', () => {
    const ranges = foldingRanges(royal);
    expect(ranges.length).toBeGreaterThan(1000);
    expect(ranges.every((r) => r.endLine > r.startLine)).toBe(true);
  });

  it('handles non-Latin content', () => {
    const multiscript = analyzeDocument(
      readFileSync(join(fixtures, 'unicode', 'names-multiscript.ged'), 'utf8'),
    );
    const symbols = documentSymbols(multiscript);
    expect(symbols.map((s) => s.detail)).toContain('山田 太郎');
    expect(symbols.map((s) => s.detail)).toContain('محمد الخوارزمي');
  });
});
