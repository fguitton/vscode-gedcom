/**
 * The calendars GEDCOM admits, converted to Gregorian.
 *
 * A date in a calendar most readers cannot compute in their heads is exactly the
 * date they most need help with. `@#DFRENCH R@ 2 VEND 1795` is meaningless until
 * somebody says 23 September 1794.
 *
 * Each calendar is handled by whatever is most trustworthy for it, and nothing
 * here is asserted without a fixed point to check it against — see
 * `calendars.test.ts`. A conversion that is quietly wrong is worse than none,
 * because a reader has no way to catch it.
 */

import {
  BuddhistCalendar,
  CalendarDate,
  GregorianCalendar,
  HebrewCalendar,
  toCalendar,
} from '@internationalized/date';

import { EQUINOX_DAYS, EQUINOX_FIRST_YEAR } from './equinoxes.generated.ts';

/** Year, month and day in the proleptic Gregorian calendar. */
export interface Gregorian {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Hebrew, by way of `@internationalized/date`.
 *
 * The arithmetic is fixed rather than observed — a mean new moon plus four
 * postponement rules — but it is fiddly enough that using an implementation
 * everybody else uses is worth more than one written here.
 */
export function fromHebrew(year: number, month: number, day: number): Gregorian | undefined {
  const calendar = new HebrewCalendar();

  try {
    const date = new CalendarDate(calendar, year, month, day);

    // The library rolls an impossible day into the next month rather than
    // refusing it — 31 Tishrei becomes 1 Cheshvan — so the bounds are checked
    // here. A file saying 31 Tishrei is wrong, and should be told so.
    if (month > calendar.getMonthsInYear(date) || day > calendar.getDaysInMonth(date)) {
      return undefined;
    }

    const converted = toCalendar(date, new GregorianCalendar());
    return { year: converted.year, month: converted.month, day: converted.day };
  } catch {
    return undefined;
  }
}

/**
 * Thai, which no GEDCOM version defines.
 *
 * Thai civil dates are the Buddhist Era: the Gregorian calendar with its years
 * numbered from 543 BC, so 2568 BE is 2025. Files exported in Thailand carry
 * them, written as an extension escape — `@#DTHAI@` — and a reader who does not
 * know the offset sees a date five centuries in the future.
 *
 * Supported because a file contains it, not because a specification says so: the
 * escape syntax is defined, the calendar named in it is not, and refusing to read
 * what somebody actually wrote helps nobody.
 */
export function fromThai(year: number, month: number, day: number): Gregorian | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  try {
    const converted = toCalendar(
      new CalendarDate(new BuddhistCalendar(), year, month, day),
      new GregorianCalendar(),
    );
    return { year: converted.year, month: converted.month, day: converted.day };
  } catch {
    return undefined;
  }
}

/**
 * Julian, by counting days.
 *
 * Both calendars are pure arithmetic over a day count, so this is exact by
 * construction and needs no library: convert to a Julian day number, then back
 * out through the Gregorian rules.
 */
export function fromJulian(year: number, month: number, day: number): Gregorian | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;

  return fromJulianDay(jdn);
}

/** The Gregorian date of a Julian day number. */
function fromJulianDay(jdn: number): Gregorian {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);

  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/**
 * French Republican, from the equinoxes themselves.
 *
 * The calendar as enacted did not compute its leap years: the year began on the
 * day of the true autumn equinox at Paris, and a year was long or short
 * according to where the next equinox fell. Romme's arithmetic rule was a
 * *proposal* to replace that, and it disagrees with observation inside the
 * calendar's own lifetime — it puts An XII at 23 September 1803, where the
 * equinox puts it at the 24th.
 *
 * So the definition is used rather than an approximation of it, from a table of
 * observed equinoxes covering 1583 to 2999. Outside that range there is nothing
 * to observe and the arithmetic rule is the only answer available.
 */
const ROMME_LEAP = (year: number): boolean => {
  const next = year + 1;
  return next % 4 === 0 && (next % 100 !== 0 || next % 400 === 0);
};

/** The Julian day number of 22 September 1792, and the Gregorian year An I began. */
const FRENCH_EPOCH_JDN = 2_375_840;
const FRENCH_EPOCH_YEAR = 1792;

/** Vendémiaire through Fructidor, then the complementary days. */
const FRENCH_MONTHS = 13;

/** The Julian day number a French Republican year starts on. */
function frenchYearStart(year: number): number {
  const gregorian = FRENCH_EPOCH_YEAR + year - 1;
  const index = gregorian - EQUINOX_FIRST_YEAR;

  if (index >= 0 && index < EQUINOX_DAYS.length) {
    const day = 20 + Number(EQUINOX_DAYS[index]);
    return gregorianToJulianDay(gregorian, 9, day);
  }

  // Beyond the table: count from the epoch by the arithmetic rule, which is all
  // anyone has for a year nobody observed.
  let elapsed = 0;
  for (let y = 1; y < year; y += 1) elapsed += ROMME_LEAP(y) ? 366 : 365;
  return FRENCH_EPOCH_JDN + elapsed;
}

export function fromFrenchRepublican(
  year: number,
  month: number,
  day: number,
): Gregorian | undefined {
  if (year < 1 || month < 1 || month > FRENCH_MONTHS || day < 1) return undefined;

  const start = frenchYearStart(year);
  // How long the year actually ran, which is what decides whether there was a
  // sixth complementary day — the equinox says, not a rule.
  const length = frenchYearStart(year + 1) - start;
  const limit = month === 13 ? length - 360 : 30;
  if (day > limit) return undefined;

  return fromJulianDay(start + (month - 1) * 30 + day - 1);
}

/** The Julian day number of a Gregorian date. */
function gregorianToJulianDay(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;

  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}
