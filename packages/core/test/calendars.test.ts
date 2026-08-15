/**
 * Converting the calendars GEDCOM admits into Gregorian.
 *
 * The anchors are the point of the file. A conversion that is subtly wrong is
 * worse than none at all — a reader has no way to notice — so each calendar is
 * pinned to dates checkable outside this repository: ICU for Hebrew, the 1752
 * adjustment for Julian, and the history books for the French Republican ones.
 */

import { describe, expect, it } from 'vitest';

import { fromFrenchRepublican, fromHebrew, fromJulian, fromThai } from '../src/calendar.ts';

const show = (date: { year: number; month: number; day: number } | undefined): string =>
  date ? `${date.day}/${date.month}/${date.year}` : 'nothing';

describe('Hebrew', () => {
  it('lands on dates ICU agrees with', () => {
    // 1 Tishrei 5760 was 11 September 1999 — Rosh Hashanah that year.
    expect(show(fromHebrew(5760, 1, 1))).toBe('11/9/1999');
    expect(show(fromHebrew(5760, 1, 15))).toBe('25/9/1999');
  });

  it('refuses a day the month does not have', () => {
    expect(fromHebrew(5760, 1, 31)).toBeUndefined();
  });
});

describe('Julian', () => {
  it('reproduces the 1752 adjustment', () => {
    // Britain skipped eleven days: 14 September Julian is 25 September Gregorian.
    expect(show(fromJulian(1752, 9, 14))).toBe('25/9/1752');
  });

  it('agrees with the Gregorian reform of 1582', () => {
    // 4 October Julian was the last day before the reform; the next Gregorian
    // day was the 15th, so 5 October Julian is 15 October Gregorian.
    expect(show(fromJulian(1582, 10, 5))).toBe('15/10/1582');
  });

  it('is exact where the two calendars still agreed', () => {
    // They diverge by three days a century; in the third century they matched.
    expect(show(fromJulian(200, 3, 1))).toBe('1/3/200');
  });
});

describe('French Republican', () => {
  it('starts on the day the Republic did', () => {
    // 1 Vendémiaire An I is 22 September 1792, the autumn equinox at Paris.
    expect(show(fromFrenchRepublican(1, 1, 1))).toBe('22/9/1792');
  });

  it('reproduces the dates the history books name', () => {
    // 9 Thermidor An II — the fall of Robespierre, 27 July 1794.
    expect(show(fromFrenchRepublican(2, 11, 9))).toBe('27/7/1794');
    // 18 Brumaire An VIII — Napoleon's coup, 9 November 1799.
    expect(show(fromFrenchRepublican(8, 2, 18))).toBe('9/11/1799');
  });

  it('keeps the leap years the calendar actually observed', () => {
    // III, VII and XI were sextile years, so An IV begins a day later than a
    // common year would put it.
    expect(show(fromFrenchRepublican(3, 1, 1))).toBe('22/9/1794');
    expect(show(fromFrenchRepublican(4, 1, 1))).toBe('23/9/1795');
  });

  it('allows a sixth complementary day only in a leap year', () => {
    expect(fromFrenchRepublican(3, 13, 6)).toBeDefined();
    expect(fromFrenchRepublican(2, 13, 6)).toBeUndefined();
  });
});

describe('Thai', () => {
  it('reads the Buddhist Era, which is Gregorian plus 543 years', () => {
    // No GEDCOM version defines this calendar; Thai files carry it anyway.
    expect(show(fromThai(2568, 8, 14))).toBe('14/8/2025');
    // The end of the absolute monarchy, 24 June 1932, is 2475 BE.
    expect(show(fromThai(2475, 6, 24))).toBe('24/6/1932');
  });
});

describe('French Republican, observed rather than computed', () => {
  it('follows the equinox where the arithmetic rule disagrees', () => {
    // An XII began on 24 September 1803 — the day of the true equinox at Paris.
    // Romme's proposed rule, which most software uses, puts it on the 23rd, and
    // the calendar was still in daily use that year.
    expect(show(fromFrenchRepublican(12, 1, 1))).toBe('24/9/1803');
    // An XIV, the last year the calendar ran, ends 31 December 1805.
    expect(show(fromFrenchRepublican(14, 1, 1))).toBe('23/9/1805');
  });

  it('reads the year length from the equinoxes either side of it', () => {
    // Nothing declares a leap year; the sixth complementary day exists when the
    // next equinox happens to fall 366 days later.
    expect(fromFrenchRepublican(3, 13, 6)).toBeDefined();
    expect(fromFrenchRepublican(2, 13, 6)).toBeUndefined();
  });
});
