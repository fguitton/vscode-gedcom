/**
 * Date arithmetic.
 *
 * Ages are the one derived fact a reader checks against their own arithmetic, so
 * the edge cases matter: a birthday that has not come round yet, a year written
 * alone, a date before the birth it is measured from.
 */

import { describe, expect, it } from 'vitest';

import { ageAt, dayNumber, parseExactDate, relativeTime, yearOf } from '../src/date.ts';

describe('yearOf', () => {
  it('reads a bare year', () => {
    expect(yearOf('1901')).toBe(1901);
  });

  it('takes the last year of a range, which is when it stopped being true', () => {
    expect(yearOf('BET 1830 AND 1840')).toBe(1840);
    expect(yearOf('FROM 1914 TO 1918')).toBe(1918);
  });

  it('reads the year out of a full date', () => {
    expect(yearOf('12 AUG 1901')).toBe(1901);
  });

  it('has no answer where there is no year', () => {
    expect(yearOf('AUG')).toBeUndefined();
    expect(yearOf('')).toBeUndefined();
  });
});

describe('dayNumber', () => {
  it('agrees with the epoch', () => {
    expect(dayNumber({ day: 1, month: 1, year: 1970, weekday: 'Thursday' })).toBe(0);
  });

  it('handles years under 100, which the Date constructor shifts', () => {
    const early = parseExactDate('1 JAN 0050');
    expect(early?.year).toBe(50);
    expect(dayNumber(early!)).toBeLessThan(0);
  });
});

describe('ageAt', () => {
  it('computes an exact age from two exact dates', () => {
    expect(ageAt('12 AUG 1901', '12 AUG 1935')).toEqual({ years: 34, approximate: false });
  });

  it('does not count a birthday that has not come round yet', () => {
    expect(ageAt('12 AUG 1901', '11 AUG 1935')).toEqual({ years: 33, approximate: false });
    expect(ageAt('12 AUG 1901', '1 MAR 1935')).toEqual({ years: 33, approximate: false });
  });

  it('counts the birthday itself', () => {
    expect(ageAt('12 AUG 1901', '12 AUG 1902')).toEqual({ years: 1, approximate: false });
  });

  it('falls back to subtracting years, and says that it did', () => {
    expect(ageAt('1901', '1935')).toEqual({ years: 34, approximate: true });
    expect(ageAt('12 AUG 1901', 'ABT 1935')).toEqual({ years: 34, approximate: true });
  });

  it('reports a negative age rather than hiding it', () => {
    // A date before the recorded birth is a real finding, not something to smooth
    // over; the caller decides how loudly to say so.
    expect(ageAt('12 AUG 1901', '12 AUG 1899')?.years).toBe(-2);
  });

  it('has no answer without a year on both sides', () => {
    expect(ageAt('', '12 AUG 1935')).toBeUndefined();
    expect(ageAt('12 AUG 1901', 'unknown')).toBeUndefined();
  });
});

describe('relativeTime', () => {
  const now = new Date(Date.UTC(2026, 7, 13));

  it('names the near past in the words people use', () => {
    expect(relativeTime('13 AUG 2026', now)).toBe('today');
    expect(relativeTime('12 AUG 2026', now)).toBe('yesterday');
    expect(relativeTime('3 AUG 2026', now)).toBe('10 days ago');
  });

  it('switches to months, then years', () => {
    expect(relativeTime('13 APR 2026', now)).toBe('4 months ago');
    expect(relativeTime('13 AUG 2024', now)).toBe('2 years ago');
    expect(relativeTime('13 AUG 2025', now)).toBe('a year ago');
  });

  it('notices a date that has not happened yet', () => {
    expect(relativeTime('1 JAN 2030', now)).toBe('in the future');
  });

  it('has no answer for a date that is not exact', () => {
    expect(relativeTime('ABT 2020', now)).toBeUndefined();
    expect(relativeTime('2020', now)).toBeUndefined();
  });
});
