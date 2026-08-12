/**
 * Relationships and date reading.
 *
 * GEDCOM never states that two people are siblings — it states that both are a
 * CHIL of the same FAM. Every question a reader asks about a person is that join.
 */

import { describe, expect, it } from 'vitest';

import { describeDate, parseExactDate } from '../src/date.ts';
import { analyze } from '../src/index.ts';
import { lifespan, relationsOf } from '../src/relations.ts';
import { bytes } from './corpus.ts';

const TREE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @GP1@ INDI',
  '1 NAME Grand /Parent/',
  '1 FAMS @F0@',
  '0 @GP2@ INDI',
  '1 FAMS @F0@',
  '0 @F0@ FAM',
  '1 HUSB @GP1@',
  '1 WIFE @GP2@',
  '1 CHIL @I1@',
  '1 CHIL @SIB@',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 AUG 1901',
  '1 DEAT',
  '2 DATE 3 MAR 1975',
  '1 FAMC @F0@',
  '1 FAMS @F1@',
  '0 @SIB@ INDI',
  '1 NAME Sister /Smith/',
  '1 FAMC @F0@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @W1@',
  '1 CHIL @C1@',
  '1 CHIL @C2@',
  '0 @W1@ INDI',
  '1 FAMS @F1@',
  '0 @C1@ INDI',
  '1 FAMC @F1@',
  '0 @C2@ INDI',
  '1 FAMC @F1@',
  '0 TRLR',
  '',
].join('\n');

const analysis = analyze(bytes(TREE));

describe('relations', () => {
  const relations = relationsOf(analysis, 'I1');

  it('finds parents through the family the person is a child of', () => {
    expect(relations.parents.sort()).toEqual(['GP1', 'GP2']);
  });

  it('finds siblings without counting the person themselves', () => {
    expect(relations.siblings).toEqual(['SIB']);
  });

  it('finds a spouse through the family the person is a spouse in', () => {
    expect(relations.spouses).toEqual(['W1']);
  });

  it('finds children', () => {
    expect(relations.children.sort()).toEqual(['C1', 'C2']);
  });

  it('reports nothing for a record that is not a person', () => {
    expect(relationsOf(analysis, 'F1').children).toEqual([]);
  });

  it('reads a lifespan from birth and death years', () => {
    expect(lifespan(analysis, 'I1')).toBe('1901–1975');
  });

  it('reports no lifespan when neither is recorded', () => {
    expect(lifespan(analysis, 'SIB')).toBeUndefined();
  });
});

describe('exact dates', () => {
  it('reads the weekday of a complete date', () => {
    // 12 August 1901 was a Monday.
    expect(parseExactDate('12 AUG 1901')?.weekday).toBe('Monday');
    expect(parseExactDate('3 MAR 1975')?.weekday).toBe('Monday');
  });

  it('handles years before 100 without shifting them into the 1900s', () => {
    expect(parseExactDate('1 JAN 0099')?.year).toBe(99);
  });

  it('refuses anything that is not a complete Gregorian date', () => {
    // A weekday would be wrong or meaningless for all of these.
    for (const payload of ['1901', 'AUG 1901', 'ABT 12 AUG 1901', 'BET 1901 AND 1908']) {
      expect(parseExactDate(payload)).toBeUndefined();
    }
  });

  it('refuses other calendars, where a Gregorian weekday would be wrong', () => {
    expect(parseExactDate('JULIAN 12 AUG 1901')).toBeUndefined();
    expect(parseExactDate('12 AUG 1901 BCE')).toBeUndefined();
  });

  it('rejects a day the month does not have', () => {
    expect(parseExactDate('31 FEB 1901')).toBeUndefined();
    expect(parseExactDate('29 FEB 1900')).toBeUndefined();
    expect(parseExactDate('29 FEB 2000')?.weekday).toBe('Tuesday');
  });
});

describe('qualified dates', () => {
  it.each([
    ['ABT 1901', 'Approximate'],
    ['EST 1901', 'Estimated'],
    ['CAL 1901', 'Calculated'],
    ['BEF 1901', 'Before'],
    ['AFT 1901', 'After'],
    ['BET 1901 AND 1908', 'between'],
    ['FROM 1901 TO 1908', 'period'],
  ])('describes %s', (payload, expected) => {
    expect(describeDate(payload)).toContain(expected);
  });

  it('says nothing about an unqualified date', () => {
    expect(describeDate('12 AUG 1901')).toBeUndefined();
  });
});
