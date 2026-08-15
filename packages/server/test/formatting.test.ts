import { describe, expect, it } from 'vitest';
import { analyzeDocument, formatDocument } from '../src/features.ts';

describe('formatDocument', () => {
  it('normalizes extra spacing and standardizes tag casing', () => {
    const source = [
      '0   head',
      '1   gedc',
      '2   vers 7.0',
      '0   @I1@   indi',
      '1   name   John /Smith/',
      '1   sex   M',
      '1   birt',
      '2   date   12 AUG 1900',
      '0   trlr',
    ].join('\n');

    const expected = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 SEX M',
      '1 BIRT',
      '2 DATE 12 AUG 1900',
      '0 TRLR',
      '',
    ].join('\n');

    const analysis = analyzeDocument(source);
    const edits = formatDocument(analysis);
    expect(edits.length).toBe(1);
    expect(edits[0]!.newText).toBe(expected);
  });

  it('removes blank lines and leading whitespace', () => {
    const source = [
      '0 HEAD',
      '',
      '1 GEDC',
      '2 VERS 7.0',
      '',
      '  0 @I1@ INDI',
      '1 NAME Jane /Doe/',
      '0 TRLR',
    ].join('\n');

    const expected = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 NAME Jane /Doe/',
      '0 TRLR',
      '',
    ].join('\n');

    const analysis = analyzeDocument(source);
    const edits = formatDocument(analysis);
    expect(edits.length).toBe(1);
    expect(edits[0]!.newText).toBe(expected);
  });

  it('returns no edits if document is already cleanly formatted', () => {
    const source = ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @I1@ INDI', '0 TRLR', ''].join('\n');

    const analysis = analyzeDocument(source);
    const edits = formatDocument(analysis);
    expect(edits.length).toBe(0);
  });
});
