import { describe, expect, it } from 'vitest';
import { analyzeDocument, workspaceSymbols } from '../src/features.ts';

const URI = 'file:///tree.ged';

const SOURCE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '0 @I2@ INDI',
  '1 NAME Jane /Doe/',
  '1 SEX F',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '0 @S1@ SOUR',
  '1 TITL Census 1900',
  '0 TRLR',
].join('\n');

describe('workspaceSymbols', () => {
  const analysis = analyzeDocument(SOURCE);

  it('returns all top-level entity records when query is empty', () => {
    const symbols = workspaceSymbols(analysis, URI, '');
    expect(symbols.length).toBe(4);
    expect(symbols.map((s) => s.name)).toEqual([
      'John Smith (@I1@)',
      'Jane Doe (@I2@)',
      'John Smith + Jane Doe (@F1@)',
      'Census 1900 (@S1@)',
    ]);
  });

  it('filters by person name', () => {
    const symbols = workspaceSymbols(analysis, URI, 'Jane');
    expect(symbols.length).toBe(2); // Jane Doe INDI and the FAM that includes Jane
    expect(symbols.some((s) => s.name.includes('Jane Doe (@I2@)'))).toBe(true);
  });

  it('filters by cross-reference identifier', () => {
    const symbols = workspaceSymbols(analysis, URI, 'S1');
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.name).toBe('Census 1900 (@S1@)');
  });

  it('filters by tag name', () => {
    const symbols = workspaceSymbols(analysis, URI, 'SOUR');
    expect(symbols.length).toBe(1);
    expect(symbols[0]!.name).toBe('Census 1900 (@S1@)');
  });
});
