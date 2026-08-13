/**
 * Collapsing by hierarchy.
 *
 * GEDCOM lines all start at column zero — or, in files that indent, at a column
 * that means nothing to an editor — so indentation-based folding does nothing
 * for them. The level number carries the whole structure instead, and every
 * structure with something beneath it gets a fold: a record collapses whole, and
 * so does each event, each address, each date with a time under it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { analyzeDocument, foldingRanges } from '../src/features.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const INDENTED = readFileSync(join(root, 'fixtures', 'style', 'indent-1-space.ged'), 'utf8');

/** Folds keyed by the line they start on, both 0-based. */
function foldsOf(text: string): Map<number, number> {
  const analysis = analyzeDocument(text);
  return new Map(foldingRanges(analysis).map((range) => [range.startLine, range.endLine]));
}

/**
 * Located by content rather than by number, so the fixture can gain a line
 * without every expectation here needing to be renumbered.
 */
function lineOf(text: string, needle: string): number {
  const index = text.split(/\r?\n/).findIndex((line) => line.trim().startsWith(needle));
  expect(index, `no line starting with ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('a file that indents its levels', () => {
  const folds = foldsOf(INDENTED);
  const at = (needle: string) => lineOf(INDENTED, needle);

  it('collapses a record whole', () => {
    // From the record's own line down to the last line beneath it.
    expect(folds.get(at('0 @I1@ INDI'))).toBe(at('0 @I2@ INDI') - 1);
  });

  it('collapses a name over its pieces', () => {
    expect(folds.get(at('1 NAME Harriet'))).toBe(at('2 SURN Ashworth'));
  });

  it('collapses nested blocks independently', () => {
    // RESI holds ADDR holds the three jurisdiction lines, and each level folds.
    expect(folds.get(at('1 RESI'))).toBe(at('3 CTRY England'));
    expect(folds.get(at('2 ADDR'))).toBe(at('3 CTRY England'));
  });

  it('collapses a date over the time beneath it', () => {
    expect(folds.get(at('1 CHAN'))).toBe(at('3 TIME'));
    expect(folds.get(at('2 DATE 14 FEB 1998'))).toBe(at('3 TIME'));
  });

  it('offers no fold for a line with nothing beneath it', () => {
    expect(folds.has(at('1 SEX F'))).toBe(false);
    expect(folds.has(at('0 TRLR'))).toBe(false);
  });
});

describe('continuations', () => {
  const NOTE = [
    '0 HEAD',
    '1 GEDC',
    '2 VERS 7.0',
    '0 @N1@ SNOTE A note that runs',
    '1 CONT across three lines',
    '1 CONT and ends here.',
    '0 TRLR',
    '',
  ].join('\n');

  it('folds a continuation into the structure it continues', () => {
    // CONT is not a structure of its own — the parser folds it into the payload
    // — so the record's fold has to reach past it to the last continued line.
    expect(foldsOf(NOTE).get(3)).toBe(5);
  });
});

describe('records of every kind', () => {
  const FILE = [
    '0 HEAD',
    '1 SOUR PAF',
    '0 @S1@ SUBM',
    '1 NAME Denis',
    '1 ADDR Somewhere',
    '0 @I1@ INDI',
    '1 NAME John /Smith/',
    '0 TRLR',
    '',
  ].join('\n');

  it('collapses a submitter as readily as an individual', () => {
    const folds = foldsOf(FILE);
    expect(folds.get(0)).toBe(1); // HEAD
    expect(folds.get(2)).toBe(4); // SUBM
    expect(folds.get(5)).toBe(6); // INDI
  });
});
