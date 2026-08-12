/**
 * Tree-aware semantic tokens.
 *
 * These four signals are the reason semantic tokens exist alongside the grammar:
 * every one of them is a question about the tree or the whole document, which no
 * regular expression can answer.
 */

import { describe, expect, it } from 'vitest';

import { analyzeDocument, semanticTokens, semanticTokensLegend } from '../src/features.ts';

interface Decoded {
  line: number;
  start: number;
  length: number;
  type: string;
  modifiers: string[];
}

/** Reverses the delta encoding so assertions can be written in absolute terms. */
function decode(data: number[]): Decoded[] {
  const tokens: Decoded[] = [];
  let line = 0;
  let start = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i]!;
    const deltaStart = data[i + 1]!;
    line += deltaLine;
    start = deltaLine === 0 ? start + deltaStart : deltaStart;

    const bits = data[i + 4]!;
    tokens.push({
      line,
      start,
      length: data[i + 2]!,
      type: semanticTokensLegend.tokenTypes[data[i + 3]!]!,
      modifiers: semanticTokensLegend.tokenModifiers.filter(
        (_, index) => (bits & (1 << index)) !== 0,
      ),
    });
  }

  return tokens;
}

const tokensFor = (source: string) => decode(semanticTokens(analyzeDocument(source)));

/** The token covering a substring's first occurrence. */
function tokenAt(source: string, needle: string): Decoded {
  const lines = source.split('\n');
  for (const [index, text] of lines.entries()) {
    const column = text.indexOf(needle);
    if (column < 0) continue;
    const found = tokensFor(source).find(
      (t) => t.line === index && t.start <= column && column < t.start + t.length,
    );
    if (found) return found;
  }
  throw new Error(`No token covering ${needle}`);
}

describe('tags removed by the target version', () => {
  const v7 = ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @I1@ INDI', '1 RFN 12345', '0 TRLR', ''].join(
    '\n',
  );

  it('marks a 5.5.1-only tag deprecated inside a 7.0 file', () => {
    // RFN was replaced by EXID in 7.0. It is not merely unknown — it had a
    // meaning this version dropped, and themes strike deprecated tokens through.
    expect(tokenAt(v7, 'RFN').modifiers).toContain('deprecated');
  });

  it('leaves the same tag alone in a 5.5.1 file', () => {
    const v5 = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 5.5.1',
      '0 @I1@ INDI',
      '1 RFN 12345',
      '0 TRLR',
      '',
    ].join('\n');
    expect(tokenAt(v5, 'RFN').modifiers).not.toContain('deprecated');
  });

  it('marks a 7.0-only tag deprecated inside a 5.5.1 file', () => {
    const v5 = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 EXID x', '0 TRLR', ''].join(
      '\n',
    );
    expect(tokenAt(v5, 'EXID').modifiers).toContain('deprecated');
  });

  it('does not mark a tag both versions share', () => {
    expect(tokenAt(v7, 'INDI').modifiers).not.toContain('deprecated');
  });
});

describe('date uncertainty', () => {
  const dated = (payload: string) =>
    [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 BIRT',
      `2 DATE ${payload}`,
      '0 TRLR',
      '',
    ].join('\n');

  it.each(['ABT', 'EST', 'CAL', 'INT'])('marks %s as uncertain', (keyword) => {
    const source = dated(`${keyword} 1901`);
    expect(tokenAt(source, keyword).modifiers).toContain('uncertain');
  });

  it.each(['BEF', 'AFT', 'FROM'])('does not mark %s as uncertain', (keyword) => {
    // A bounded date is not a guess: BEF 1901 is exact about what it claims.
    const source = dated(`${keyword} 1901`);
    expect(tokenAt(source, keyword).modifiers).not.toContain('uncertain');
  });

  it('emits an operator token for each keyword in a range', () => {
    const source = dated('BET 1901 AND 1908');
    const operators = tokensFor(source).filter((t) => t.type === 'operator');
    expect(operators).toHaveLength(2);
  });

  it('emits nothing for an exact date', () => {
    const source = dated('12 AUG 1901');
    expect(tokensFor(source).filter((t) => t.type === 'operator')).toEqual([]);
  });
});

describe('unreferenced records', () => {
  const source = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @I1@ INDI',
    '1 FAMS @F1@',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '0 @I9@ INDI',
    '1 NAME Orphan /Nobody/',
    '0 TRLR',
    '',
  ].join('\n');

  it('marks a record nothing points at', () => {
    expect(tokenAt(source, 'I9').modifiers).toContain('unreferenced');
  });

  it('leaves a referenced record alone', () => {
    expect(tokenAt(source, 'F1').modifiers).not.toContain('unreferenced');
    expect(tokenAt(source, 'I1').modifiers).not.toContain('unreferenced');
  });

  it('still marks it as a declaration', () => {
    expect(tokenAt(source, 'I9').modifiers).toContain('declaration');
  });
});

describe('record-type tinting', () => {
  const source = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @I1@ INDI',
    '1 NAME John /Smith/',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '0 @S1@ SOUR',
    '1 TITL A parish register',
    '0 TRLR',
    '',
  ].join('\n');

  it('carries the containing record down to its substructures', () => {
    expect(tokenAt(source, 'NAME').modifiers).toContain('individual');
    expect(tokenAt(source, 'HUSB').modifiers).toContain('family');
    expect(tokenAt(source, 'TITL').modifiers).toContain('source');
  });

  it('tints the record line itself', () => {
    expect(tokenAt(source, 'INDI').modifiers).toContain('individual');
  });

  it('leaves records with no meaningful tint untouched', () => {
    // Tinting every record type would be noise rather than information.
    const head = tokenAt(source, 'HEAD').modifiers;
    expect(head).not.toContain('individual');
    expect(head).not.toContain('family');
    expect(head).not.toContain('source');
  });

  it('does not leak a tint across record boundaries', () => {
    expect(tokenAt(source, 'HUSB').modifiers).not.toContain('individual');
  });
});

describe('the legend stays consistent with what is emitted', () => {
  it('emits only types and modifiers the legend declares', () => {
    const source = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 _UID x',
      '1 RFN 9',
      '1 BIRT',
      '2 DATE ABT 1901',
      '1 FAMS @VOID@',
      '0 TRLR',
      '',
    ].join('\n');

    for (const token of tokensFor(source)) {
      expect(semanticTokensLegend.tokenTypes).toContain(token.type);
      for (const modifier of token.modifiers) {
        expect(semanticTokensLegend.tokenModifiers).toContain(modifier);
      }
      expect(token.length).toBeGreaterThan(0);
    }
  });
});
