/**
 * Age payloads.
 *
 * `20y 6m` is compact and opaque, and it is frequently the only evidence for a
 * birth date in the record. Reading it is half the job; the other half is being
 * able to compare it against the dates already recorded.
 */

import { describe, expect, it } from 'vitest';

import { ageInDays, describeAge, formatAgeAtEvent, parseAge } from '../src/age.ts';

describe('parseAge', () => {
  it('reads each unit', () => {
    expect(parseAge('20y')).toEqual({ years: 20 });
    expect(parseAge('6m')).toEqual({ months: 6 });
    expect(parseAge('3w')).toEqual({ weeks: 3 });
    expect(parseAge('12d')).toEqual({ days: 12 });
  });

  it('reads a full duration', () => {
    expect(parseAge('20y 6m 3w 12d')).toEqual({ years: 20, months: 6, weeks: 3, days: 12 });
  });

  it('reads the bounds', () => {
    expect(parseAge('< 8y')).toEqual({ bound: '<', years: 8 });
    expect(parseAge('>30y')).toEqual({ bound: '>', years: 30 });
  });

  it('accepts units written out of the specified order', () => {
    // The grammar fixes an order that exporters do not reliably honour, and a
    // payload written the other way round is unambiguous even so.
    expect(parseAge('6m 20y')).toEqual({ years: 20, months: 6 });
  });

  it('reads the GEDCOM 5.5.1 words', () => {
    expect(parseAge('CHILD')).toEqual({ phrase: 'CHILD' });
    expect(parseAge('INFANT')).toEqual({ phrase: 'INFANT' });
    expect(parseAge('stillborn')).toEqual({ phrase: 'STILLBORN' });
  });

  it('is case-insensitive about units', () => {
    expect(parseAge('20Y 6M')).toEqual({ years: 20, months: 6 });
  });

  it('refuses text that merely contains a unit', () => {
    // Otherwise a free-text payload with a stray `3d` in it would parse as an age.
    expect(parseAge('about 3d after the fire')).toBeUndefined();
    expect(parseAge('unknown')).toBeUndefined();
    expect(parseAge('')).toBeUndefined();
  });
});

describe('describeAge', () => {
  it('writes a duration out in words', () => {
    expect(describeAge({ years: 20, months: 6 })).toBe('20 years, 6 months');
    expect(describeAge({ years: 1 })).toBe('1 year');
    expect(describeAge({ days: 1 })).toBe('1 day');
  });

  it('says what a bound means rather than repeating the symbol', () => {
    expect(describeAge({ bound: '<', years: 8 })).toBe('less than 8 years');
    expect(describeAge({ bound: '>', years: 30 })).toBe('more than 30 years');
  });

  it('expands the words, which say more than they appear to', () => {
    expect(describeAge({ phrase: 'CHILD' })).toBe('a child — under eight years old');
    expect(describeAge({ phrase: 'INFANT' })).toBe('an infant — under one year old');
  });
});

describe('ageInDays', () => {
  it('converts a duration for comparison against dates', () => {
    expect(ageInDays({ years: 1 })).toBeCloseTo(365.2425, 3);
    expect(ageInDays({ days: 10 })).toBe(10);
    expect(ageInDays({ weeks: 2 })).toBe(14);
  });

  it('has no answer for the words, which name a range', () => {
    expect(ageInDays({ phrase: 'CHILD' })).toBeUndefined();
  });
});

describe('formatAgeAtEvent', () => {
  it('formats event age phrases with verb and duration', () => {
    const deathAge = formatAgeAtEvent('12 MAR 1850', '4 NOV 1920', 'DEAT');
    expect(deathAge).toBeDefined();
    expect(deathAge?.label).toBe('Died age 70');
    expect(deathAge?.tooltip).toContain('**Died age 70**');

    const gxDeathAge = formatAgeAtEvent('+1850-03-12', '+1920-11-04', 'http://gedcomx.org/Death');
    expect(gxDeathAge).toBeDefined();
    expect(gxDeathAge?.label).toBe('Died age 70');

    const marrAge = formatAgeAtEvent('1900', '1925', 'MARR');
    expect(marrAge?.label).toBe('Married age 25');

    const infantAge = formatAgeAtEvent('12 AUG 1901', '14 SEP 1901', 'BAPM');
    expect(infantAge?.label).toBe('Baptised under a year old');
  });

  it('returns undefined for invalid or out-of-range dates', () => {
    expect(formatAgeAtEvent('1920', '1850', 'DEAT')).toBeUndefined();
    expect(formatAgeAtEvent('invalid', '1850', 'DEAT')).toBeUndefined();
  });
});
